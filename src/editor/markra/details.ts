import { syntaxTree } from '@codemirror/language'
import {
  EditorState,
  StateEffect,
  StateField,
  type Extension,
  type Line,
  type Range,
  RangeSet,
} from '@codemirror/state'
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
 * mdpad therefore turns the section into editor structure: the wrapper tags
 * are hidden, the summary is a row you can rename in place, and the body stays
 * ordinary editor lines. Markra's live preview edits that body directly, so
 * there is no dialog and no mode switch: click the content and type.
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
      contentFrom,
      contentTo: contentFrom + close.index,
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

/** Offsets let the editor keep the body as real, directly editable lines. */
export type DetailsLayout = DetailsBlock & {
  openTagFrom: number
  openTagTo: number
  summaryFrom: number
  summaryTo: number
  summaryContentFrom: number
  summaryContentTo: number
  closeFrom: number
  closeTo: number
}

/**
 * Parses a whole section. The close tag is matched by depth, so a nested
 * section stays inside the outer one instead of ending it early; a missing
 * close tag keeps the rest of the document, which is what a browser does with
 * malformed HTML too.
 */
export function parseDetailsLayout(source: string): DetailsLayout | null {
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

  const innerFrom = openEnd + 1
  const inner = source.slice(innerFrom, closeStart)
  const summary = findSummary(inner)

  return {
    attributes: withoutOpenAttribute(attributes),
    body: (summary ? inner.slice(0, summary.from) + inner.slice(summary.to) : inner).trim(),
    closeFrom: closeStart,
    closeTo: closeEnd,
    open: hasOpenAttribute(attributes),
    openTagFrom: start,
    openTagTo: innerFrom,
    summary: summary?.content.trim() ?? '',
    summaryContentFrom: summary ? innerFrom + summary.contentFrom : -1,
    summaryContentTo: summary ? innerFrom + summary.contentTo : -1,
    summaryFrom: summary ? innerFrom + summary.from : -1,
    summaryTo: summary ? innerFrom + summary.to : -1,
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

type DetailsRange = { block: DetailsBlock; from: number; layout: DetailsLayout; source: string; to: number }

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
    const layout = parseDetailsLayout(source)
    if (!layout) continue

    ranges.push({ block: layout, from: line.from, layout, source, to })
  }

  return ranges
}

type EditableSection = {
  bodyFirst: number
  bodyLast: number
  closeFrom: number
  closeTo: number
  closeLine: Line
  openLine: Line
  summaryContentFrom: number
  summaryContentTo: number
  summaryLine: Line
}

/**
 * The layout a section needs to become directly editable: the wrapper tags
 * each on a line of their own, a one-line summary, and a body that is ordinary
 * Markdown between them. Anything else keeps the rendered block widget.
 */
function editableSection(state: EditorState, range: DetailsRange): EditableSection | null {
  const { layout, source } = range
  if (layout.summaryFrom < 0) return null

  const openLine = state.doc.lineAt(range.from)
  if (source.slice(layout.openTagTo, openLine.to - range.from).trim()) return null

  const summaryStart = range.from + layout.summaryFrom
  const summaryEnd = range.from + layout.summaryTo
  const summaryLine = state.doc.lineAt(summaryStart)
  if (state.doc.lineAt(summaryEnd).number !== summaryLine.number) return null
  if (summaryLine.number <= openLine.number) return null
  if (source.slice(summaryLine.from - range.from, layout.summaryFrom).trim()) return null
  if (source.slice(layout.summaryTo, summaryLine.to - range.from).trim()) return null
  if (source.slice(layout.summaryContentFrom, layout.summaryContentTo).includes('\n')) return null

  const closeLine = state.doc.lineAt(range.from + layout.closeFrom)
  if (state.doc.lineAt(range.from + layout.closeTo).number !== closeLine.number) return null
  if (closeLine.number <= summaryLine.number + 1) return null
  if (source.slice(closeLine.from - range.from, layout.closeFrom).trim()) return null
  if (source.slice(layout.closeTo).trim()) return null

  return {
    bodyFirst: summaryLine.number + 1,
    bodyLast: closeLine.number - 1,
    closeFrom: range.from + layout.closeFrom,
    closeTo: range.from + layout.closeTo,
    closeLine,
    openLine,
    summaryContentFrom: range.from + layout.summaryContentFrom,
    summaryContentTo: range.from + layout.summaryContentTo,
    summaryLine,
  }
}

function rangeAt(state: EditorState, from: number) {
  return detailsRanges(state).find((range) => range.from === from)
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

/** The summary input that is open, and the one waiting for a rebuild. */
let activeSummary: { sectionFrom: number; commit: () => boolean; dispose: () => void } | null = null
let pendingSummaryEdit: string | null = null

/**
 * Drops editor state that belongs to a document which is no longer open: the
 * widget DOM is gone, and a stale commit would edit the wrong file.
 */
export function resetDetailsState() {
  pendingEdit.clear()
  pendingSummaryEdit = null
  activeSummary?.dispose()
  activeSummary = null
  activeEditor?.dispose()
  activeEditor = null
}

/* --------------------------------------------------------------- widget */

const CHEVRON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'

/**
 * The top row of a section. The body below it is ordinary editor content, so
 * the row only has to offer the summary: click the title to edit it, click the
 * chevron to fold the section. No buttons, no dialog.
 */
class DetailsSummaryWidget extends WidgetType {
  private readonly block: DetailsBlock
  private readonly source: string
  private readonly open: boolean
  private readonly sectionFrom: number
  private readonly standalone: boolean
  private readonly nested: boolean
  private readonly options: DetailsPluginOptions
  private dispose: (() => void) | null = null
  /** An open title input must not be reused as the new widget's DOM. */
  private editing = false

  constructor(
    block: DetailsBlock,
    source: string,
    open: boolean,
    sectionFrom: number,
    options: DetailsPluginOptions,
    standalone = false,
    nested = false,
  ) {
    super()
    this.block = block
    this.source = source
    this.open = open
    this.sectionFrom = sectionFrom
    this.options = options
    this.standalone = standalone
    this.nested = nested
  }

  eq(other: DetailsSummaryWidget) {
    return (
      other.block.summary === this.block.summary &&
      other.open === this.open &&
      other.sectionFrom === this.sectionFrom &&
      other.standalone === this.standalone &&
      other.nested === this.nested &&
      !this.editing &&
      !other.editing
    )
  }

  ignoreEvent() {
    return true
  }

  get estimatedHeight() {
    return 42
  }

  destroy() {
    this.dispose?.()
    this.dispose = null
  }

  toDOM(view: EditorView) {
    const document = view.dom.ownerDocument

    const root = document.createElement('div')
    root.className = [
      'md-details-summary-row',
      this.standalone ? 'md-details-summary-standalone' : '',
      this.nested ? 'md-details-nested' : '',
    ]
      .filter(Boolean)
      .join(' ')
    root.dataset.open = String(this.open)
    root.dataset.collapsed = String(!this.open)

    let editing = false
    let closing = false
    let finishDraft: ((focusBody: boolean) => boolean) | null = null

    const buildLabel = (): HTMLElement => {
      const label = document.createElement('span')
      label.className = 'md-details-summary'
      label.tabIndex = 0
      label.setAttribute('role', 'button')
      label.title = 'Edit section title'

      const inline = markdownInline(this.block.summary, document)
      if (inline.length > 0) label.append(...inline)
      else {
        label.textContent = 'Details'
        label.classList.add('is-empty')
      }

      label.addEventListener('mousedown', (event) => {
        if ((event.target as Element | null)?.closest('a[href]')) return
        startEditing(event)
      })
      label.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        startEditing(event)
      })

      return label
    }

    const renderLabel = () => {
      editing = false
      this.editing = false
      root.querySelector('.md-details-open-control')?.remove()
      const label = buildLabel()
      const input = root.querySelector('.md-details-summary-input')
      if (input) input.replaceWith(label)
      else if (!root.querySelector('.md-details-summary')) root.append(label)
    }

    const startEditing = (event?: Event, selectAll = false) => {
      event?.preventDefault()
      event?.stopPropagation()
      if (editing) return

      if (activeSummary && activeSummary.sectionFrom !== this.sectionFrom) {
        pendingSummaryEdit = this.source
        if (activeSummary.commit()) return
        pendingSummaryEdit = null
      }

      editing = true
      this.editing = true
      closing = false

      const input = document.createElement('input')
      input.type = 'text'
      input.className = 'md-details-summary-input'
      input.value = this.block.summary
      input.placeholder = 'Section title'
      input.spellcheck = true
      input.setAttribute('aria-label', 'Section title')

      const openControl = document.createElement('label')
      openControl.className = 'md-details-open-control'
      const openCheckbox = document.createElement('input')
      openCheckbox.type = 'checkbox'
      openCheckbox.checked = this.block.open
      openCheckbox.setAttribute('aria-label', 'Open by default')
      // Keep the title input focused while the checkbox is clicked, or the
      // blur would commit before the checkbox state is read.
      openControl.addEventListener('mousedown', (event) => event.preventDefault())
      openControl.addEventListener('keydown', (event) => event.stopPropagation())
      openControl.append(openCheckbox, document.createTextNode('Open by default'))

      const finish = (focusBody: boolean, cancel: boolean): boolean => {
        if (closing) return false
        closing = true
        if (activeSummary?.sectionFrom === this.sectionFrom) activeSummary = null
        finishDraft = null

        if (cancel) {
          renderLabel()
          return false
        }

        const value = input.value.trim()
        const nextOpen = openCheckbox.checked
        const summaryChanged = value !== this.block.summary.trim()
        const openChanged = nextOpen !== this.block.open
        if (!summaryChanged && !openChanged) {
          renderLabel()
          return false
        }

        const current = rangeAt(view.state, this.sectionFrom)
        if (!current || current.layout.summaryContentFrom < 0) {
          renderLabel()
          return false
        }

        const changes: Array<{ from: number; insert: string; to: number }> = []
        if (summaryChanged) {
          changes.push({
            from: current.from + current.layout.summaryContentFrom,
            insert: value,
            to: current.from + current.layout.summaryContentTo,
          })
        }
        if (openChanged) {
          const attributes = [nextOpen ? 'open' : '', current.block.attributes.trim()]
            .filter(Boolean)
            .join(' ')
          changes.push({
            from: current.from + current.layout.openTagFrom,
            insert: `<details${attributes ? ` ${attributes}` : ''}>`,
            to: current.from + current.layout.openTagTo,
          })
        }

        // Changing the default must not fold the section the author is in.
        const effects = openChanged ? setDetailsOpen.of({ from: current.from, open: this.open }) : undefined
        view.dispatch({ changes, effects, userEvent: 'input' })
        if (focusBody) {
          // Positions after the edits are only known once they are applied.
          const next = rangeAt(view.state, this.sectionFrom)
          const nextSection = next ? editableSection(view.state, next) : null
          if (this.open && nextSection) {
            view.dispatch({
              selection: { anchor: view.state.doc.line(nextSection.bodyFirst).from },
            })
          }
          view.focus()
        }
        return true
      }

      finishDraft = (focusBody) => finish(focusBody, false)
      activeSummary = {
        sectionFrom: this.sectionFrom,
        commit: () => finishDraft?.(false) ?? false,
        dispose: () => {
          closing = true
        },
      }

      input.addEventListener('keydown', (event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          finish(false, true)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          finish(true, false)
        }
      })
      // Commit after the click that blurred the title has moved the caret.
      // Committing during the mousedown rebuilds the lines under it.
      input.addEventListener('blur', () => {
        window.setTimeout(() => {
          if (closing) return
          finish(false, false)
        }, 0)
      })
      input.addEventListener('mousedown', (event) => event.stopPropagation())

      const label = root.querySelector('.md-details-summary')
      label?.replaceWith(input)
      root.append(openControl)
      input.focus()
      if (selectAll) input.select()
      else input.setSelectionRange(input.value.length, input.value.length)
    }

    const chevron = document.createElement('button')
    chevron.type = 'button'
    chevron.className = 'md-details-chevron-button'
    chevron.innerHTML = CHEVRON
    chevron.setAttribute('aria-label', this.open ? 'Collapse section' : 'Expand section')
    chevron.setAttribute('aria-expanded', String(this.open))

    let pointerHandled = false
    const toggle = (event?: Event) => {
      event?.preventDefault()
      event?.stopPropagation()
      finishDraft?.(false)

      const current = rangeAt(view.state, this.sectionFrom)
      if (!current) return
      const section = editableSection(view.state, current)
      const next = !this.open

      let selection: { anchor: number } | undefined
      if (!next && section) {
        const active = view.state.selection.main
        const bodyFrom = view.state.doc.line(section.bodyFirst).from
        if (active.from <= section.closeLine.from && active.to >= bodyFrom) {
          selection = { anchor: Math.min(section.closeLine.to + 1, view.state.doc.length) }
        }
      }

      view.dispatch({
        effects: setDetailsOpen.of({ from: current.from, open: next }),
        selection,
      })
      if (selection) view.focus()
    }

    chevron.addEventListener('mousedown', (event) => {
      pointerHandled = true
      toggle(event)
    })
    chevron.addEventListener('click', (event) => {
      if (pointerHandled) {
        pointerHandled = false
        return
      }
      toggle(event)
    })

    root.addEventListener('mousedown', (event) => event.stopPropagation())
    root.addEventListener('click', (event) => {
      const target = event.target as Element | null
      const anchor = target?.closest('a[href]')
      if (!anchor) return

      event.preventDefault()
      event.stopPropagation()
      const href = anchor.getAttribute('href')?.trim() ?? ''
      if (!href || href.startsWith('#')) return
      const resolved =
        this.options.resolveLinkHref?.(href) ?? (/^[a-z][a-z\d+.-]*:/i.test(href) ? href : null)
      if (resolved) this.options.openExternalUrl?.(resolved)
    })

    root.append(chevron, buildLabel())

    this.dispose = () => {
      closing = true
      if (activeSummary?.sectionFrom === this.sectionFrom) activeSummary = null
      finishDraft = null
    }

    if (pendingSummaryEdit === this.source) {
      pendingSummaryEdit = null
      window.requestAnimationFrame(() => {
        if (root.isConnected) startEditing(undefined, true)
      })
    }

    return root
  }
}

/** The gap below a section. A widget has no caret position inside it. */
class DetailsSpacerWidget extends WidgetType {
  eq() {
    return true
  }

  get estimatedHeight() {
    return 14
  }

  toDOM() {
    const spacer = document.createElement('div')
    spacer.className = 'md-details-close-spacer'
    spacer.setAttribute('aria-hidden', 'true')
    return spacer
  }
}

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

    const shell = document.createElement('div')
    shell.className = 'md-details-shell'
    root.append(shell)

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
      summary.title = 'Double-click to edit the section'
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
      hint.textContent = 'Markdown · ⌘/Ctrl+↵ or click away to save · Esc to cancel'

      foot.append(hint)
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
  const fallbacks: Array<{ from: number; to: number }> = []
  const stack: DetailsRange[] = []

  for (const range of detailsRanges(state)) {
    while (
      stack.length > 0 &&
      !(range.from > stack[stack.length - 1].from && range.to <= stack[stack.length - 1].to)
    ) {
      stack.pop()
    }
    const nested = stack.length > 0
    stack.push(range)

    if (fallbacks.some((fallback) => range.from >= fallback.from && range.to <= fallback.to)) {
      continue
    }

    const open = preview?.get(range.from) ?? range.block.open
    const section = editableSection(state, range)

    // A standard section keeps its body as real editor lines, so Markra's live
    // preview edits it directly. Anything unusual keeps the rendered widget.
    if (!section) {
      fallbacks.push({ from: range.from, to: range.to })
      decorations.push(
        Decoration.replace({
          block: true,
          widget: new DetailsWidget(
            range.block,
            range.source,
            range.from,
            range.to,
            open,
            options,
          ),
        }).range(state.doc.lineAt(range.from).from, state.doc.lineAt(range.to).to),
      )
      continue
    }

    if (!open) {
      // Collapsed is one row. Hiding lines would leave Markra's spacers
      // behind and the caret could wander into invisible content.
      decorations.push(
        Decoration.replace({
          block: true,
          widget: new DetailsSummaryWidget(
            range.block,
            range.source,
            false,
            range.from,
            options,
            true,
            nested,
          ),
        }).range(state.doc.lineAt(range.from).from, state.doc.lineAt(range.to).to),
      )
      continue
    }

    decorations.push(
      Decoration.line({ class: 'md-details-hidden-line' }).range(section.openLine.from),
    )

    decorations.push(
      Decoration.replace({
        block: true,
        widget: new DetailsSummaryWidget(
          range.block,
          range.source,
          open,
          range.from,
          options,
          false,
          nested,
        ),
      }).range(section.summaryLine.from, section.summaryLine.to),
    )

    if (nested) {
      for (let number = section.bodyFirst; number <= section.bodyLast; number += 1) {
        decorations.push(
          Decoration.line({ class: 'md-details-body-nested' }).range(state.doc.line(number).from),
        )
      }
    }

    // The closing tag is markup, not content. A block spacer keeps the gap
    // below the box without giving the caret a line to land on.
    decorations.push(
      Decoration.replace({ block: true, widget: new DetailsSpacerWidget() }).range(
        section.closeLine.from,
        section.closeLine.to,
      ),
    )
  }

  return Decoration.set(decorations, true)
}

/** Wrapper tags and a collapsed section are structure, not caret targets. */
function buildAtomicRanges(state: EditorState): RangeSet<Decoration> {
  const preview = state.field(detailsOpenState, false)
  const ranges: Range<Decoration>[] = []
  const fallbacks: Array<{ from: number; to: number }> = []

  for (const range of detailsRanges(state)) {
    if (fallbacks.some((fallback) => range.from >= fallback.from && range.to <= fallback.to)) {
      continue
    }

    const open = preview?.get(range.from) ?? range.block.open
    const section = editableSection(state, range)
    if (!section || !open) {
      fallbacks.push({ from: range.from, to: range.to })
      ranges.push(
        Decoration.mark({}).range(
          state.doc.lineAt(range.from).from,
          state.doc.lineAt(range.to).to,
        ),
      )
      continue
    }

    ranges.push(Decoration.mark({}).range(section.openLine.from, section.openLine.to))
    ranges.push(Decoration.mark({}).range(section.summaryLine.from, section.summaryLine.to))
  }

  return RangeSet.of(ranges, true)
}

const detailsAtomic = StateField.define<RangeSet<Decoration>>({
  create: (state) => buildAtomicRanges(state),
  update: (value, transaction) => {
    const openChanged =
      transaction.startState.field(detailsOpenState) !== transaction.state.field(detailsOpenState)
    return transaction.docChanged || openChanged ? buildAtomicRanges(transaction.state) : value
  },
})

/**
 * A block widget replaces whole lines, and CodeMirror only accepts those from
 * a state field — a view plugin may not provide block decorations.
 */
function detailsField(options: DetailsPluginOptions) {
  return StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, options),
    update: (value, transaction) => {
      const openChanged =
        transaction.startState.field(detailsOpenState) !== transaction.state.field(detailsOpenState)
      return transaction.docChanged || openChanged
        ? buildDecorations(transaction.state, options)
        : value
    },
    provide: (field) => EditorView.decorations.from(field),
  })
}

/* ----------------------------------------------------------------- style */

const MONO = 'var(--editor-code-font-family, ui-monospace, SFMono-Regular, Menlo, monospace)'
const FOCUS_RING = '0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent)'

const detailsTheme = EditorView.baseTheme({
  '.md-details-hidden-line': {
    display: 'none',
  },
  '.md-details-close-spacer': {
    height: '0.9em',
  },
  '.md-details-summary-row': {
    alignItems: 'center',
    background: 'var(--editor-bg-secondary, var(--bg-secondary))',
    border: '1px solid var(--editor-border, var(--border-default))',
    borderRadius: '9px',
    boxSizing: 'border-box',
    color: 'var(--editor-text-heading, var(--text-heading))',
    display: 'flex',
    fontSize: '0.98em',
    fontWeight: '620',
    gap: '8px',
    lineHeight: '1.5',
    margin: '0.9em 0 0.2em',
    minHeight: '40px',
    padding: '8px 14px 8px 34px',
    position: 'relative',
    transition: 'border-color 120ms ease, background-color 120ms ease',
    whiteSpace: 'normal',
  },
  '.md-details-summary-row:hover': {
    borderColor: 'var(--editor-border-strong, var(--border-strong))',
  },
  '.md-details-summary-standalone': {
    margin: '0.9em 0',
  },
  '.md-details-summary-row.md-details-nested': {
    borderRadius: '7px',
    margin: '0.6em 14px 0.2em',
  },
  '.md-details-summary-row.md-details-nested.md-details-summary-standalone': {
    margin: '0.6em 14px',
  },
  '.md-details-chevron-button': {
    background: 'transparent',
    border: '0',
    borderRadius: '5px',
    color: 'var(--editor-text-secondary, var(--text-secondary))',
    cursor: 'pointer',
    display: 'grid',
    height: '20px',
    left: '9px',
    padding: '0',
    placeItems: 'center',
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    width: '20px',
  },
  '.md-details-chevron-button:hover': {
    background: 'var(--bg-hover)',
    color: 'var(--editor-text-heading, var(--text-heading))',
  },
  '.md-details-chevron-button:focus-visible': {
    outline: '2px solid color-mix(in srgb, var(--accent) 45%, transparent)',
    outlineOffset: '1px',
  },
  '.md-details-chevron-button svg': {
    height: '15px',
    transition: 'transform 140ms ease',
    width: '15px',
  },
  '.md-details-summary-row[data-open="true"] .md-details-chevron-button svg': {
    transform: 'rotate(90deg)',
  },
  '.md-details-summary-row .md-details-summary': {
    cursor: 'text',
    flex: '1 1 auto',
    minWidth: '0',
    outline: 'none',
    overflowWrap: 'anywhere',
  },
  '.md-details-summary-row .md-details-summary:focus-visible': {
    borderRadius: '4px',
    outline: '2px solid color-mix(in srgb, var(--accent) 45%, transparent)',
    outlineOffset: '2px',
  },
  '.md-details-summary-row .md-details-summary.is-empty': {
    color: 'var(--editor-text-secondary, var(--text-secondary))',
    fontStyle: 'italic',
    fontWeight: '520',
  },
  '.md-details-summary-row .md-details-summary-input': {
    background: 'var(--editor-paper-bg, var(--bg-primary))',
    border: '1px solid var(--editor-border, var(--border-default))',
    borderRadius: '5px',
    boxSizing: 'border-box',
    color: 'var(--editor-text-heading, var(--text-heading))',
    flex: '1 1 auto',
    font: 'inherit',
    fontWeight: '620',
    minWidth: '0',
    outline: 'none',
    padding: '4px 7px',
    width: '100%',
  },
  '.md-details-summary-row .md-details-summary-input:focus': {
    borderColor: 'color-mix(in srgb, var(--accent) 50%, var(--editor-border, var(--border-default)))',
    boxShadow: FOCUS_RING,
  },
  /* Nested content sits one step in, level with the nested header. */
  '.md-details-body-nested': {
    paddingLeft: '14px !important',
  },
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
    flex: '0 0 auto',
    fontSize: '0.78em',
    gap: '6px',
    userSelect: 'none',
    whiteSpace: 'nowrap',
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
})

/* ---------------------------------------------------------------- plugin */

export function detailsPlugin(options: DetailsPluginOptions = {}): MarkraPlugin {
  const extension: Extension = [
    detailsOpenState,
    detailsAtomic,
    detailsField(options),
    detailsTheme,
    EditorView.atomicRanges.of((view) => view.state.field(detailsAtomic)),
  ]

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
          const blockFrom = at + (afterLine ? 2 : 0)

          view.dispatch({
            changes: { from: at, insert, to: at },
            scrollIntoView: true,
            selection: { anchor: at + insert.length },
            userEvent: 'input',
          })

          // Expanding is a second, position-only transaction: the new section
          // is known to exist by then, and its title input can take focus.
          pendingSummaryEdit = DETAILS_TEMPLATE
          view.dispatch({ effects: setDetailsOpen.of({ from: blockFrom, open: true }) })
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
