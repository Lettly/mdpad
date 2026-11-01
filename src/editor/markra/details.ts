import { syntaxTree } from '@codemirror/language'
import { EditorState, StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view'
import { defineMarkraPlugin, type MarkraPlugin } from '@markra/editor/codemirror'
import { markdownBlocks, markdownInline } from './markdown-html'

/**
 * A collapsible section is raw HTML, and Markra renders raw HTML as static
 * markup: the summary is not parsed as Markdown and the body — which lives
 * after a blank line, so it is a separate HTML block — leaks out of the box.
 *
 * mdpad therefore renders the whole `<details>…</details>` range as one block.
 * The summary and the body are both Markdown, the section collapses like it
 * does on GitHub, and editing happens in place: no dialog, no separate mode.
 */

export type DetailsBlock = {
  /** Markdown for the summary line. */
  summary: string
  /** Markdown for the content. */
  body: string
  /** Whether the section is expanded when the page loads. */
  open: boolean
  /** Other attributes on the opening tag, preserved verbatim. */
  attributes: string
  /** Text that follows `</details>` on the closing line. */
  trailing: string
}

export type DetailsPluginOptions = {
  openExternalUrl?: (url: string) => void
  resolveImageSrc?: (source: string) => string
  /** Maps a relative link onto somewhere the browser can open it. */
  resolveLinkHref?: (href: string) => string | null
}

const EMPTY_BLOCK: DetailsBlock = {
  attributes: '',
  body: '',
  open: false,
  summary: '',
  trailing: '',
}

const DETAILS_TAG = /<(\/?)(details|summary)\b[^>]*>/gi
const OPENING_LINE = /^[\t ]*<details\b/i
const FENCE_LINE = /^[\t ]{0,3}(`{3,}|~{3,})/

/* --------------------------------------------------------------- parsing */

/** A tag inside inline code is an example, not structure. */
function maskInlineCode(line: string): string {
  return line.replace(/(`+)[\s\S]*?\1/g, (match) => ' '.repeat(match.length))
}

/**
 * Tags inside a fenced code block are examples, not structure. Masking the
 * fences keeps their offsets, so a `<summary>` in a code sample is never
 * mistaken for the section's own summary.
 */
function maskFencedCode(source: string): string {
  let fence: string | null = null

  return source
    .split('\n')
    .map((line) => {
      const match = FENCE_LINE.exec(line)
      if (match) {
        const marker = match[1][0]
        if (!fence) fence = marker
        else if (fence === marker) fence = null
        return ' '.repeat(line.length)
      }
      return fence ? ' '.repeat(line.length) : maskInlineCode(line)
    })
    .join('\n')
}

function findSummary(inner: string) {
  const masked = maskFencedCode(inner)
  const tag = new RegExp(DETAILS_TAG.source, 'gi')
  let depth = 0
  let match: RegExpExecArray | null

  while ((match = tag.exec(masked))) {
    const closing = match[1] === '/'
    const name = match[2].toLowerCase()

    if (name === 'details') {
      depth += closing ? -1 : 1
      if (depth < 0) return null
      continue
    }

    if (closing || depth !== 0) continue

    const contentFrom = match.index + match[0].length
    const close = /<\/summary\s*>/i.exec(masked.slice(contentFrom))
    if (!close) return null

    return {
      content: inner.slice(contentFrom, contentFrom + close.index),
      from: match.index,
      to: contentFrom + close.index + close[0].length,
    }
  }

  return null
}

function hasOpenAttribute(attributes: string) {
  return /(^|\s)open(\s|=|$)/i.test(attributes)
}

function withoutOpenAttribute(attributes: string) {
  return attributes
    .replace(/(^|\s)open(\s*=\s*("[^"]*"|'[^']*'|[^\s"']*))?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parses a whole section. The close tag is matched by depth, so a nested
 * section stays inside the outer one instead of ending it early; a missing
 * close tag keeps the rest of the document, which is what a browser does with
 * malformed HTML too.
 */
export function parseDetails(source: string): DetailsBlock | null {
  const masked = maskFencedCode(source)
  const start = masked.search(/<details\b/i)
  if (start < 0 || masked.slice(0, start).trim()) return null

  const openEnd = masked.indexOf('>', start)
  if (openEnd < 0) return null
  const attributes = source.slice(start + '<details'.length, openEnd)

  const tag = new RegExp(DETAILS_TAG.source, 'gi')
  tag.lastIndex = start
  let depth = 0
  let closeStart = source.length
  let closeEnd = source.length
  let match: RegExpExecArray | null

  while ((match = tag.exec(masked))) {
    if (match[2].toLowerCase() !== 'details') continue
    if (match[1] === '/') {
      depth -= 1
      if (depth === 0) {
        closeStart = match.index
        closeEnd = match.index + match[0].length
        break
      }
    } else {
      depth += 1
    }
  }

  const inner = source.slice(openEnd + 1, closeStart)
  const summary = findSummary(inner)

  return {
    attributes: withoutOpenAttribute(attributes),
    body: (summary ? inner.slice(0, summary.from) + inner.slice(summary.to) : inner).trim(),
    open: hasOpenAttribute(attributes),
    summary: summary?.content.trim() ?? '',
    trailing: source.slice(closeEnd),
  }
}

export function serializeDetails(block: DetailsBlock): string {
  const attributes = [block.open ? 'open' : '', block.attributes.trim()].filter(Boolean).join(' ')
  const summary = block.summary.trim()
  const body = block.body.trim()

  const parts = [`<details${attributes ? ` ${attributes}` : ''}>`]
  if (summary) parts.push(`<summary>${summary}</summary>`)
  if (body) parts.push('', body)
  parts.push('', `</details>${block.trailing}`)
  return parts.join('\n')
}

export const DETAILS_TEMPLATE = serializeDetails({
  ...EMPTY_BLOCK,
  summary: 'Section title',
})

/* -------------------------------------------------------------- ranges */

function isInsideCode(state: EditorState, position: number) {
  let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(
    position,
    position === 0 ? 1 : -1,
  )
  while (node) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'InlineCode') {
      return true
    }
    node = node.parent
  }
  return false
}

function tagCount(line: string, pattern: RegExp) {
  return (line.match(pattern) ?? []).length
}

type DetailsRange = { block: DetailsBlock; from: number; source: string; to: number }

/**
 * Finds sections line by line: a `<details>` only opens a block when it starts
 * a line, and the block ends on the line that closes it. Matching the raw text
 * instead would swallow a real section from a `<details>` written inline in
 * prose.
 */
function detailsRanges(state: EditorState): DetailsRange[] {
  const ranges: DetailsRange[] = []

  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number)
    if (!OPENING_LINE.test(line.text)) continue
    if (isInsideCode(state, line.from)) continue

    let depth = 0
    let endNumber = -1
    let fence: string | null = null
    for (let candidate = number; candidate <= state.doc.lines; candidate += 1) {
      const raw = state.doc.line(candidate).text
      const fenceMatch = FENCE_LINE.exec(raw)
      if (fenceMatch) {
        const marker = fenceMatch[1][0]
        if (!fence) fence = marker
        else if (fence === marker) fence = null
        continue
      }
      if (fence) continue

      const text = maskInlineCode(raw)
      depth += tagCount(text, /<details\b/gi) - tagCount(text, /<\/details\s*>/gi)
      if (depth <= 0) {
        endNumber = candidate
        break
      }
    }

    const to = endNumber > 0 ? state.doc.line(endNumber).to : state.doc.length
    const source = state.sliceDoc(line.from, to)
    const block = parseDetails(source)
    if (!block) continue

    ranges.push({ block, from: line.from, source, to })
    number = endNumber > 0 ? endNumber : state.doc.lines
  }

  return ranges
}

/* ------------------------------------------------------------ open state */

const setDetailsOpen = StateEffect.define<{ from: number; open: boolean }>()

/**
 * Toggling a section in the preview is not a document edit: it only changes
 * what is visible here. The state survives the decoration rebuild that a
 * keystroke elsewhere triggers.
 */
const detailsOpenState = StateField.define<Map<number, boolean>>({
  create: () => new Map(),
  update(value, transaction) {
    let next = value
    if (transaction.docChanged) {
      // A whole-document replacement is a different file: positions from the
      // old one mean nothing here.
      let replaced = false
      transaction.changes.iterChangedRanges((fromA, toA) => {
        if (fromA === 0 && toA === transaction.startState.doc.length) replaced = true
      })

      next = new Map()
      if (!replaced) {
        for (const [from, open] of value) next.set(transaction.changes.mapPos(from, -1), open)
      }
    }
    for (const effect of transaction.effects) {
      if (!effect.is(setDetailsOpen)) continue
      if (next === value) next = new Map(value)
      next.set(transaction.changes.mapPos(effect.value.from, -1), effect.value.open)
    }
    return next
  },
})

/* -------------------------------------------------------------- editing */

type EditFocus = 'summary' | 'body'

/**
 * A section that asked to be edited as the decorations were rebuilt. The key
 * is the section source, not a position: committing another section's draft
 * can move every section after it.
 */
const pendingEdit = new Map<string, EditFocus>()

/** The one open inline editor, so opening another one commits the draft. */
let activeEditor: { commit: () => boolean; dispose: () => void } | null = null

/**
 * Drops editor state that belongs to a document which is no longer open: the
 * widget DOM is gone, and a stale commit would edit the wrong file.
 */
export function resetDetailsState() {
  pendingEdit.clear()
  activeEditor?.dispose()
  activeEditor = null
}

/* --------------------------------------------------------------- widget */

const PENCIL =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3l-7.4 7.4-3 .7.7-3 7.4-7.4Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>'

const CHEVRON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'

class DetailsWidget extends WidgetType {
  private readonly block: DetailsBlock
  private readonly source: string
  private readonly from: number
  private readonly to: number
  private readonly open: boolean
  private readonly options: DetailsPluginOptions
  private dispose: (() => void) | null = null

  constructor(
    block: DetailsBlock,
    source: string,
    from: number,
    to: number,
    open: boolean,
    options: DetailsPluginOptions,
  ) {
    super()
    this.block = block
    this.source = source
    this.from = from
    this.to = to
    this.open = open
    this.options = options
  }

  eq(other: DetailsWidget) {
    // `from` and `to` are captured by the DOM's event handlers, and a section
    // that asked to open its editor must not reuse the old DOM.
    return (
      other.source === this.source &&
      other.open === this.open &&
      other.from === this.from &&
      other.to === this.to &&
      !pendingEdit.has(this.source)
    )
  }

  /** The widget owns its events: a click must never move the editor caret. */
  ignoreEvent() {
    return true
  }

  /** CodeMirror discards the DOM on a rebuild or on unmount. */
  destroy() {
    this.dispose?.()
    this.dispose = null
  }

  get estimatedHeight() {
    return this.open ? 120 : 42
  }

  toDOM(view: EditorView) {
    const document = view.dom.ownerDocument
    const block = this.block

    const root = document.createElement('div')
    root.className = 'md-details-block'
    root.dataset.open = String(this.open)

    const editButton = document.createElement('button')
    editButton.type = 'button'
    editButton.className = 'md-details-edit'
    editButton.title = 'Edit section'
    editButton.setAttribute('aria-label', 'Edit collapsible section')
    editButton.innerHTML = `${PENCIL}<span>Edit</span>`

    const shell = document.createElement('div')
    shell.className = 'md-details-shell'
    root.append(editButton, shell)

    let editing = false
    let closing = false
    let lastOpen = this.open
    let summaryElement: HTMLElement | null = null
    let detailsElement: HTMLDetailsElement | null = null
    let summaryInput: HTMLInputElement | null = null
    let bodyInput: HTMLTextAreaElement | null = null
    let openCheckbox: HTMLInputElement | null = null

    /* ------------------------------------------------------- rendered view */

    const buildRendered = () => {
      const details = document.createElement('details')
      details.className = 'md-details-section'
      details.open = lastOpen
      details.addEventListener('toggle', () => {
        if (details.open === lastOpen) return
        lastOpen = details.open
        view.dispatch({ effects: setDetailsOpen.of({ from: this.from, open: details.open }) })
      })

      const summary = document.createElement('summary')
      const chevron = document.createElement('span')
      chevron.className = 'md-details-chevron'
      chevron.innerHTML = CHEVRON

      const label = document.createElement('span')
      label.className = 'md-details-summary'
      const inline = markdownInline(block.summary, document)
      if (inline.length > 0) label.append(...inline)
      else {
        label.textContent = 'Details'
        label.classList.add('is-empty')
      }

      summary.append(chevron, label)
      summary.title = 'Double-click to edit the summary'
      summary.addEventListener('dblclick', (event) => {
        event.preventDefault()
        event.stopPropagation()
        requestEdit('summary')
      })

      const body = document.createElement('div')
      body.className = 'md-details-body'
      const nodes = markdownBlocks(block.body, document, {
        resolveImageSrc: this.options.resolveImageSrc,
      })

      if (nodes.length > 0) body.append(...nodes)
      else {
        const empty = document.createElement('p')
        empty.className = 'md-details-empty'
        empty.append(document.createTextNode('No content yet.'))

        const add = document.createElement('button')
        add.type = 'button'
        add.className = 'md-details-empty-add'
        add.textContent = 'Add content'
        const addContent = (event: Event) => {
          event.preventDefault()
          event.stopPropagation()
          requestEdit('body')
        }
        add.addEventListener('mousedown', addContent)
        // Keyboard activation only fires a click.
        add.addEventListener('click', addContent)
        empty.append(' ', add)
        body.append(empty)
      }

      body.addEventListener('dblclick', (event) => {
        if ((event.target as Element | null)?.closest('a')) return
        event.preventDefault()
        requestEdit('body')
      })

      details.append(summary, body)
      detailsElement = details
      summaryElement = summary

      const children: Node[] = [details]
      if (block.trailing.trim()) {
        const trailing = document.createElement('div')
        trailing.className = 'md-details-trailing'
        trailing.append(
          ...markdownBlocks(block.trailing.trim(), document, {
            resolveImageSrc: this.options.resolveImageSrc,
          }),
        )
        children.push(trailing)
      }

      shell.replaceChildren(...children)
    }

    /* ---------------------------------------------------------- edit form */

    const commit = (): boolean => {
      if (closing || !summaryInput || !bodyInput || !openCheckbox) return false
      closing = true
      activeEditor = null

      const next: DetailsBlock = {
        ...block,
        body: bodyInput.value.trim(),
        open: openCheckbox.checked,
        summary: summaryInput.value.trim(),
      }

      if (serializeDetails(next) === this.source) {
        finishEditing()
        return false
      }

      let from = this.from
      if (view.state.sliceDoc(from, from + this.source.length) !== this.source) {
        const found = view.state.doc.toString().indexOf(this.source)
        if (found < 0) {
          finishEditing()
          return false
        }
        from = found
      }

      const insert = serializeDetails(next)
      // Leave the caret on the line after the section: inside it, the raw
      // HTML would be revealed instead of the rendered block. The document
      // length is the one after the replacement, not the one before it.
      const nextLength = view.state.doc.length - this.source.length + insert.length
      const anchor = Math.min(from + insert.length + 1, nextLength)
      view.dispatch({
        changes: { from, insert, to: from + this.source.length },
        scrollIntoView: true,
        selection: { anchor },
        userEvent: 'input',
      })
      view.focus()
      return true
    }

    const finishEditing = () => {
      editing = false
      closing = false
      delete root.dataset.editing
      buildRendered()
      window.requestAnimationFrame(() => summaryElement?.focus())
    }

    const cancel = () => {
      if (closing) return
      closing = true
      if (activeEditor) activeEditor = null
      editing = false
      delete root.dataset.editing
      buildRendered()
      window.requestAnimationFrame(() => summaryElement?.focus())
    }

    const focusField = (focus: EditFocus) => {
      window.requestAnimationFrame(() => {
        if (focus === 'body' && bodyInput) {
          const end = bodyInput.value.length
          bodyInput.focus()
          bodyInput.setSelectionRange(end, end)
          return
        }
        summaryInput?.focus()
        summaryInput?.select()
      })
    }

    const startEditing = (focus: EditFocus) => {
      if (editing) {
        focusField(focus)
        return
      }
      // The widget may have been discarded by a rebuild before a deferred
      // edit request ran.
      if (!root.isConnected) return

      editing = true
      closing = false
      root.dataset.editing = 'true'
      detailsElement?.setAttribute('open', '')

      const form = document.createElement('form')
      form.className = 'md-details-editor'
      form.noValidate = true

      const head = document.createElement('div')
      head.className = 'md-details-editor-head'

      const title = document.createElement('span')
      title.className = 'md-details-editor-title'
      title.textContent = 'Collapsible section'

      const openControl = document.createElement('label')
      openControl.className = 'md-details-open-control'
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = block.open
      openControl.append(checkbox, document.createTextNode('Open by default'))
      head.append(title, openControl)

      const summary = document.createElement('input')
      summary.type = 'text'
      summary.className = 'md-details-summary-input'
      summary.value = block.summary
      summary.placeholder = 'Section title'
      summary.spellcheck = true
      summary.setAttribute('aria-label', 'Section title')

      const body = document.createElement('textarea')
      body.className = 'md-details-body-input'
      body.value = block.body
      body.placeholder = 'Write the section content in Markdown…'
      body.spellcheck = true
      body.rows = 6
      body.setAttribute('aria-label', 'Section content')

      const foot = document.createElement('div')
      foot.className = 'md-details-editor-foot'

      const hint = document.createElement('span')
      hint.className = 'md-details-editor-hint'
      hint.textContent = 'Markdown · ⌘/Ctrl+↵ to save · Esc to cancel'

      const actions = document.createElement('div')
      actions.className = 'md-details-editor-actions'

      const cancelButton = document.createElement('button')
      cancelButton.type = 'button'
      cancelButton.textContent = 'Cancel'
      cancelButton.addEventListener('mousedown', (event) => event.preventDefault())
      cancelButton.addEventListener('click', cancel)

      const saveButton = document.createElement('button')
      saveButton.type = 'submit'
      saveButton.className = 'is-primary'
      saveButton.textContent = 'Done'

      actions.append(cancelButton, saveButton)
      foot.append(hint, actions)
      form.append(head, summary, body, foot)

      const resize = () => {
        body.style.height = 'auto'
        const max = Math.max(140, Math.round(window.innerHeight * 0.55))
        body.style.height = `${Math.min(body.scrollHeight + 2, max)}px`
      }
      body.addEventListener('input', resize)
      summary.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          body.focus()
        }
      })

      form.addEventListener('submit', (event) => {
        event.preventDefault()
        commit()
      })
      form.addEventListener('keydown', (event) => {
        // The form lives inside the CodeMirror content DOM, whose keymap would
        // otherwise turn Backspace, Mod-b and friends into document edits.
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          cancel()
          return
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
      })
      form.addEventListener('keypress', (event) => event.stopPropagation())
      form.addEventListener('beforeinput', (event) => event.stopPropagation())
      form.addEventListener('paste', (event) => event.stopPropagation())

      // Clicking anywhere else commits, so a draft cannot be lost by typing in
      // the document. The zero timeout lets a click on another section's Edit
      // button hand the draft over first.
      form.addEventListener('focusout', (event) => {
        if (closing) return
        const next = event.relatedTarget as Node | null
        if (next && form.contains(next)) return
        window.setTimeout(() => {
          if (closing) return
          if (form.contains(document.activeElement)) return
          commit()
        }, 0)
      })

      shell.replaceChildren(form)
      summaryInput = summary
      bodyInput = body
      openCheckbox = checkbox

      const editor = {
        commit,
        dispose: () => {
          closing = true
        },
      }
      activeEditor = editor
      this.dispose = () => {
        editor.dispose()
        if (activeEditor === editor) activeEditor = null
      }

      window.requestAnimationFrame(resize)
      focusField(focus)
    }

    const requestEdit = (focus: EditFocus) => {
      if (editing) {
        focusField(focus)
        return
      }
      if (activeEditor) {
        pendingEdit.set(this.source, focus)
        if (activeEditor.commit()) return
        pendingEdit.delete(this.source)
      }
      startEditing(focus)
    }

    const openEditor = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      requestEdit('summary')
    }
    // A real click opens on mousedown so CodeMirror cannot move the caret
    // first; the click listener covers keyboard activation.
    editButton.addEventListener('mousedown', openEditor)
    editButton.addEventListener('click', openEditor)

    /* -------------------------------------------------------------- events */

    root.addEventListener('mousedown', (event) => event.stopPropagation())

    root.addEventListener('click', (event) => {
      const target = event.target as Element | null
      if (!target) return

      const anchor = target.closest('a[href]')
      if (anchor) {
        event.preventDefault()
        event.stopPropagation()
        const href = anchor.getAttribute('href')?.trim() ?? ''
        if (!href || href.startsWith('#')) return
        const resolved =
          this.options.resolveLinkHref?.(href) ??
          (/^[a-z][a-z\d+.-]*:/i.test(href) ? href : null)
        if (resolved) this.options.openExternalUrl?.(resolved)
        return
      }

      const copy = target.closest<HTMLElement>('[data-md-copy]')
      if (!copy) return
      event.preventDefault()
      event.stopPropagation()
      const value = copy.dataset.mdCopy ?? ''
      void navigator.clipboard
        ?.writeText(value)
        .then(() => {
          copy.dataset.copied = 'true'
          copy.textContent = 'Copied'
          window.setTimeout(() => {
            delete copy.dataset.copied
            copy.textContent = 'Copy'
          }, 1200)
        })
        .catch(() => undefined)
    })

    buildRendered()

    const focus = pendingEdit.get(this.source)
    if (focus) {
      pendingEdit.delete(this.source)
      window.requestAnimationFrame(() => startEditing(focus))
    }

    return root
  }
}

/* ---------------------------------------------------------- decorations */

function buildDecorations(state: EditorState, options: DetailsPluginOptions) {
  const preview = state.field(detailsOpenState, false)
  const decorations: Range<Decoration>[] = []

  for (const range of detailsRanges(state)) {
    const firstLine = state.doc.lineAt(range.from)
    const lastLine = state.doc.lineAt(range.to)
    const open = preview?.get(range.from) ?? range.block.open

    // A block widget has to cover whole lines; a section always starts its own
    // line, so that is exactly the range it occupies.
    decorations.push(
      Decoration.replace({
        block: true,
        widget: new DetailsWidget(range.block, range.source, range.from, range.to, open, options),
      }).range(firstLine.from, lastLine.to),
    )
  }

  return Decoration.set(decorations, true)
}

/**
 * A block widget replaces whole lines, and CodeMirror only accepts those from
 * a state field — a view plugin may not provide block decorations.
 */
function detailsField(options: DetailsPluginOptions) {
  return StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, options),
    // Toggling a section updates `detailsOpenState` without rebuilding: the
    // DOM has already toggled, and the stored state is read on the next edit.
    update: (value, transaction) =>
      transaction.docChanged ? buildDecorations(transaction.state, options) : value,
    provide: (field) => EditorView.decorations.from(field),
  })
}

/* ----------------------------------------------------------------- style */

const MONO = 'var(--editor-code-font-family, ui-monospace, SFMono-Regular, Menlo, monospace)'
const FOCUS_RING = '0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent)'

const detailsTheme = EditorView.baseTheme({
  '.md-details-block': {
    margin: '0.9em 0',
    position: 'relative',
    /* CodeMirror lines are `pre-wrap`; block HTML must not render the
       whitespace between its own tags. */
    whiteSpace: 'normal',
  },
  '.md-details-shell': {
    position: 'relative',
  },
  '.md-details-section': {
    background: 'var(--editor-bg-secondary, var(--bg-secondary))',
    border: '1px solid var(--editor-border, var(--border-default))',
    borderRadius: '9px',
    overflow: 'hidden',
    transition: 'border-color 120ms ease, background-color 120ms ease',
  },
  '.md-details-section:hover': {
    borderColor: 'var(--editor-border-strong, var(--border-strong))',
  },
  '.md-details-section > summary': {
    alignItems: 'center',
    color: 'var(--editor-text-heading, var(--text-heading))',
    cursor: 'pointer',
    display: 'flex',
    fontSize: '0.98em',
    fontWeight: '620',
    gap: '8px',
    lineHeight: '1.5',
    listStyle: 'none',
    minHeight: '40px',
    padding: '8px 76px 8px 12px',
  },
  '.md-details-section > summary::-webkit-details-marker': {
    display: 'none',
  },
  '.md-details-section > summary:focus-visible': {
    borderRadius: '8px',
    outline: '2px solid color-mix(in srgb, var(--accent) 45%, transparent)',
    outlineOffset: '-1px',
  },
  '.md-details-chevron': {
    color: 'var(--editor-text-secondary, var(--text-secondary))',
    display: 'inline-flex',
    flex: '0 0 auto',
    height: '16px',
    transition: 'transform 140ms ease',
    width: '16px',
  },
  '.md-details-chevron svg': {
    height: '16px',
    width: '16px',
  },
  '.md-details-section[open] > summary .md-details-chevron, .md-details-nested[open] > summary .md-details-chevron': {
    transform: 'rotate(90deg)',
  },
  '.md-details-summary': {
    minWidth: '0',
    overflowWrap: 'anywhere',
  },
  '.md-details-summary.is-empty': {
    color: 'var(--editor-text-secondary, var(--text-secondary))',
    fontStyle: 'italic',
    fontWeight: '520',
  },
  '.md-details-summary-heading': {
    fontWeight: '650',
  },
  '.md-details-summary-h1': { fontSize: '1.16em' },
  '.md-details-summary-h2': { fontSize: '1.1em' },
  '.md-details-summary-h3': { fontSize: '1.04em' },
  '.md-details-body': {
    color: 'var(--editor-text-primary, var(--text-primary))',
    fontSize: '0.95em',
    lineHeight: '1.72',
    padding: '0 14px 13px 36px',
  },
  '.md-details-body > :first-child': {
    marginTop: '0.15em',
  },
  '.md-details-body > :last-child': {
    marginBottom: '0',
  },
  '.md-details-body p': {
    margin: '0 0 0.75em',
  },
  '.md-details-body ul, .md-details-body ol': {
    margin: '0.35em 0 0.85em',
    paddingLeft: '1.35em',
  },
  '.md-details-body li': {
    margin: '0.2em 0',
  },
  '.md-details-body li > p': {
    margin: '0 0 0.35em',
  },
  '.md-details-body .contains-task-list': {
    listStyle: 'none',
    paddingLeft: '0.1em',
  },
  '.md-details-body .task-list-item': {
    listStyle: 'none',
  },
  '.md-details-body .task-list-item input': {
    accentColor: 'var(--accent)',
    marginRight: '0.5em',
    verticalAlign: 'middle',
  },
  '.md-details-body h1, .md-details-body h2, .md-details-body h3, .md-details-body h4, .md-details-body h5, .md-details-body h6': {
    color: 'var(--editor-text-heading, var(--text-heading))',
    fontWeight: '650',
    lineHeight: '1.35',
    margin: '1em 0 0.45em',
  },
  '.md-details-body h1': { fontSize: '1.35em' },
  '.md-details-body h2': { fontSize: '1.22em' },
  '.md-details-body h3': { fontSize: '1.1em' },
  '.md-details-body h4, .md-details-body h5, .md-details-body h6': { fontSize: '1em' },
  '.md-details-body a': {
    color: 'var(--editor-link-color, var(--link-color))',
    textDecoration: 'underline',
    textUnderlineOffset: '0.16em',
  },
  '.md-details-body strong': {
    fontWeight: '700',
  },
  '.md-details-body code': {
    background: 'var(--editor-inline-code-bg, var(--bg-code))',
    borderRadius: '4px',
    fontFamily: MONO,
    fontSize: '0.88em',
    padding: '0.12em 0.36em',
  },
  '.md-details-body pre code': {
    background: 'transparent',
    borderRadius: '0',
    padding: '0',
  },
  '.md-details-body blockquote': {
    borderLeft: '2px solid var(--editor-border-strong, var(--border-strong))',
    color: 'var(--editor-text-secondary, var(--text-secondary))',
    margin: '0.5em 0 0.9em',
    paddingLeft: '12px',
  },
  '.md-details-body blockquote > :last-child': {
    marginBottom: '0',
  },
  '.md-details-body hr': {
    border: '0',
    borderTop: '1px solid var(--editor-border, var(--border-default))',
    margin: '1em 0',
  },
  '.md-details-body img': {
    borderRadius: '6px',
    display: 'inline-block',
    height: 'auto',
    margin: '0.35em 0',
    maxWidth: '100%',
    verticalAlign: 'middle',
  },
  '.md-details-body kbd': {
    background: 'var(--editor-bg-secondary, var(--bg-secondary))',
    border: '1px solid var(--editor-border-strong, var(--border-strong))',
    borderBottomWidth: '2px',
    borderRadius: '4px',
    fontFamily: MONO,
    fontSize: '0.8em',
    padding: '1px 5px',
  },
  '.md-details-image-missing': {
    border: '1px dashed var(--editor-border-strong, var(--border-strong))',
    borderRadius: '5px',
    color: 'var(--editor-text-secondary, var(--text-secondary))',
    display: 'inline-flex',
    fontSize: '0.85em',
    padding: '2px 8px',
  },

  /* code */
  '.md-details-code': {
    background: 'var(--editor-code-bg, var(--bg-code))',
    border: '1px solid var(--editor-border, var(--border-default))',
    borderRadius: '8px',
    margin: '0.6em 0 0.95em',
    overflow: 'hidden',
  },
  '.md-details-code-head': {
    alignItems: 'center',
    borderBottom: '1px solid var(--editor-border, var(--border-default))',
    color: 'var(--editor-text-secondary, var(--text-secondary))',
    display: 'flex',
    fontFamily: MONO,
    fontSize: '0.74em',
    gap: '8px',
    justifyContent: 'space-between',
    letterSpacing: '0.02em',
    padding: '5px 8px 5px 12px',
  },
  '.md-details-code-copy': {
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: '5px',
    color: 'inherit',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '1em',
    opacity: '0',
    padding: '2px 7px',
    transition: 'opacity 120ms ease, background-color 120ms ease, color 120ms ease',
  },
  '.md-details-code:hover .md-details-code-copy, .md-details-code-copy:focus-visible': {
    opacity: '1',
  },
  '.md-details-code-copy:hover': {
    background: 'var(--bg-hover)',
    color: 'var(--editor-text-heading, var(--text-heading))',
  },
  '.md-details-code-copy[data-copied="true"]': {
    color: 'var(--editor-link-color, var(--link-color))',
    opacity: '1',
  },
  '.md-details-code pre': {
    background: 'transparent',
    border: '0',
    borderRadius: '0',
    boxShadow: 'none',
    margin: '0',
    overflowX: 'auto',
    padding: '12px 14px',
  },
  '.md-details-code code': {
    background: 'transparent',
    borderRadius: '0',
    fontSize: '0.86em',
    lineHeight: '1.65',
    padding: '0',
    whiteSpace: 'pre',
  },

  /* tables */
  '.md-details-table': {
    margin: '0.5em 0 0.95em',
    overflowX: 'auto',
  },
  '.md-details-table table': {
    borderCollapse: 'collapse',
    fontSize: '0.92em',
    margin: '0',
    tableLayout: 'auto',
    width: '100%',
  },
  '.md-details-table th, .md-details-table td': {
    border: '1px solid var(--editor-border, var(--border-default))',
    padding: '6px 12px',
    textAlign: 'left',
    verticalAlign: 'top',
  },
  '.md-details-table th': {
    background: 'var(--editor-bg-secondary, var(--bg-secondary))',
    color: 'var(--editor-text-heading, var(--text-heading))',
    fontWeight: '620',
  },
  '.md-details-table tbody tr:nth-child(even) td': {
    background: 'color-mix(in srgb, var(--editor-bg-secondary, var(--bg-secondary)) 62%, transparent)',
  },

  /* nested sections */
  '.md-details-body details.md-details-nested': {
    background: 'var(--editor-bg-secondary, var(--bg-secondary))',
    border: '1px solid var(--editor-border, var(--border-default))',
    borderRadius: '7px',
    margin: '0.6em 0',
    overflow: 'hidden',
  },
  '.md-details-body details.md-details-nested > summary': {
    alignItems: 'center',
    color: 'var(--editor-text-heading, var(--text-heading))',
    cursor: 'pointer',
    display: 'flex',
    fontSize: '0.97em',
    fontWeight: '600',
    gap: '7px',
    listStyle: 'none',
    padding: '7px 12px',
  },
  '.md-details-body details.md-details-nested > summary::-webkit-details-marker': {
    display: 'none',
  },
  '.md-details-body details.md-details-nested > .md-details-body': {
    padding: '0 12px 10px 32px',
  },

  /* footnotes */
  '.md-details-body section[data-footnotes]': {
    borderTop: '1px solid var(--editor-border, var(--border-default))',
    color: 'var(--editor-text-secondary, var(--text-secondary))',
    fontSize: '0.85em',
    marginTop: '1em',
    paddingTop: '0.7em',
  },

  /* empty state */
  '.md-details-empty': {
    color: 'var(--editor-text-secondary, var(--text-secondary))',
    fontSize: '0.9em',
    margin: '0',
  },
  '.md-details-empty-add': {
    background: 'transparent',
    border: '0',
    color: 'var(--editor-link-color, var(--link-color))',
    cursor: 'pointer',
    font: 'inherit',
    padding: '0',
    textDecoration: 'underline',
    textUnderlineOffset: '0.16em',
  },
  '.md-details-trailing': {
    marginTop: '0.5em',
  },

  /* edit affordance */
  '.md-details-edit': {
    alignItems: 'center',
    background: 'var(--editor-paper-bg, var(--bg-primary))',
    border: '1px solid var(--editor-border, var(--border-default))',
    borderRadius: '6px',
    color: 'var(--editor-text-secondary, var(--text-secondary))',
    cursor: 'pointer',
    display: 'inline-flex',
    font: 'inherit',
    fontSize: '0.76em',
    fontWeight: '560',
    gap: '5px',
    height: '26px',
    lineHeight: '1',
    opacity: '0',
    padding: '0 9px',
    position: 'absolute',
    right: '8px',
    top: '7px',
    transform: 'translateY(-1px)',
    transition: 'opacity 120ms ease, transform 120ms ease, background-color 120ms ease, color 120ms ease',
    zIndex: '2',
  },
  '.md-details-edit svg': {
    height: '12px',
    width: '12px',
  },
  '.md-details-block:hover .md-details-edit, .md-details-edit:focus-visible': {
    opacity: '1',
    transform: 'none',
  },
  '.md-details-edit:hover': {
    background: 'var(--bg-hover)',
    color: 'var(--editor-text-heading, var(--text-heading))',
  },
  '.md-details-block[data-editing="true"] .md-details-edit': {
    display: 'none',
  },
  /* A touch screen has no hover, so the edit affordance stays visible. */
  '@media (hover: none)': {
    '.md-details-edit': {
      opacity: '1',
    },
  },

  /* inline editor */
  '.md-details-editor': {
    background: 'var(--editor-paper-bg, var(--bg-primary))',
    border: '1px solid color-mix(in srgb, var(--accent) 34%, var(--editor-border, var(--border-default)))',
    borderRadius: '9px',
    display: 'grid',
    gap: '8px',
    padding: '10px',
  },
  '.md-details-editor-head': {
    alignItems: 'center',
    display: 'flex',
    gap: '10px',
    justifyContent: 'space-between',
  },
  '.md-details-editor-title': {
    color: 'var(--editor-text-secondary, var(--text-secondary))',
    fontSize: '0.72em',
    fontWeight: '640',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  '.md-details-open-control': {
    alignItems: 'center',
    color: 'var(--editor-text-secondary, var(--text-secondary))',
    cursor: 'pointer',
    display: 'inline-flex',
    fontSize: '0.78em',
    gap: '6px',
    userSelect: 'none',
  },
  '.md-details-open-control input': {
    accentColor: 'var(--accent)',
    margin: '0',
  },
  '.md-details-summary-input': {
    background: 'var(--editor-bg-secondary, var(--bg-secondary))',
    border: '1px solid var(--editor-border, var(--border-default))',
    borderRadius: '6px',
    boxSizing: 'border-box',
    color: 'var(--editor-text-heading, var(--text-heading))',
    font: 'inherit',
    fontSize: '0.98em',
    fontWeight: '620',
    outline: 'none',
    padding: '8px 10px',
    width: '100%',
  },
  '.md-details-summary-input:focus': {
    borderColor: 'color-mix(in srgb, var(--accent) 50%, var(--editor-border, var(--border-default)))',
    boxShadow: FOCUS_RING,
  },
  '.md-details-body-input': {
    background: 'var(--editor-code-bg, var(--bg-code))',
    border: '1px solid var(--editor-border, var(--border-default))',
    borderRadius: '7px',
    boxSizing: 'border-box',
    color: 'var(--editor-text-primary, var(--text-primary))',
    fontFamily: MONO,
    fontSize: '0.85em',
    lineHeight: '1.6',
    maxHeight: '55vh',
    minHeight: '120px',
    outline: 'none',
    padding: '10px 12px',
    resize: 'vertical',
    tabSize: '2',
    width: '100%',
  },
  '.md-details-body-input:focus': {
    borderColor: 'color-mix(in srgb, var(--accent) 50%, var(--editor-border, var(--border-default)))',
    boxShadow: FOCUS_RING,
  },
  '.md-details-editor-foot': {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
    justifyContent: 'space-between',
  },
  '.md-details-editor-hint': {
    color: 'var(--editor-text-secondary, var(--text-secondary))',
    fontSize: '0.74em',
  },
  '.md-details-editor-actions': {
    display: 'flex',
    gap: '6px',
  },
  '.md-details-editor-actions button': {
    background: 'var(--editor-paper-bg, var(--bg-primary))',
    border: '1px solid var(--editor-border, var(--border-default))',
    borderRadius: '6px',
    color: 'var(--editor-text-primary, var(--text-primary))',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.8em',
    fontWeight: '560',
    height: '28px',
    padding: '0 12px',
  },
  '.md-details-editor-actions button:hover': {
    background: 'var(--bg-hover)',
  },
  '.md-details-editor-actions button:focus-visible': {
    outline: '2px solid var(--accent)',
    outlineOffset: '2px',
  },
  '.md-details-editor-actions button.is-primary': {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
    color: 'var(--bg-primary)',
  },
  '.md-details-editor-actions button.is-primary:hover': {
    background: 'var(--accent-hover)',
    borderColor: 'var(--accent-hover)',
  },
})

/* ---------------------------------------------------------------- plugin */

export function detailsPlugin(options: DetailsPluginOptions = {}): MarkraPlugin {
  const extension: Extension = [detailsOpenState, detailsField(options), detailsTheme]

  return defineMarkraPlugin({
    id: 'mdpad.details',
    extension,
    commands: [
      {
        id: 'mdpad.details.insert',
        label: 'Collapsible section',
        description: 'A summary with content hidden until it is opened',
        run: (view) => {
          if (view.state.facet(EditorState.readOnly)) return false

          const { from } = view.state.selection.main
          const line = view.state.doc.lineAt(from)
          const afterLine = view.state.sliceDoc(line.from, line.to).trim().length > 0
          const at = afterLine ? line.to : line.from
          const insert = `${afterLine ? '\n\n' : ''}${DETAILS_TEMPLATE}\n\n`
          // The new section opens its inline editor as soon as it exists.
          pendingEdit.set(DETAILS_TEMPLATE, 'summary')

          view.dispatch({
            changes: { from: at, insert, to: at },
            scrollIntoView: true,
            selection: { anchor: at + insert.length },
            userEvent: 'input',
          })
          return true
        },
      },
    ],
    ui: [
      {
        command: 'mdpad.details.insert',
        group: 'Blocks',
        keywords: ['details', 'summary', 'collapse', 'disclosure', 'toggle'],
        label: 'Collapsible section',
        order: 135,
        placement: 'slash-menu',
      },
    ],
  })
}
