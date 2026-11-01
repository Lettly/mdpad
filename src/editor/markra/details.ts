import { syntaxTree } from '@codemirror/language'
import { EditorState, StateField, type Extension, type Range } from '@codemirror/state'
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
 * mdpad therefore renders the whole `<details>…</details>` range as one block:
 * the summary and the body are both Markdown, and a button opens the form that
 * edits the two parts.
 */

export type DetailsBlock = { summary: string; body: string }

const DETAILS = /^\s*<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>\s*$/i
const ANY_DETAILS = /<details\b[^>]*>[\s\S]*?<\/details>/gi

export function parseDetails(source: string): DetailsBlock | null {
  const match = DETAILS.exec(source)
  return match ? { summary: match[1].trim(), body: match[2].trim() } : null
}

export function serializeDetails({ summary, body }: DetailsBlock): string {
  return `<details>\n<summary>${summary.trim()}</summary>\n\n${body.trim()}\n\n</details>`
}

export const DETAILS_TEMPLATE = serializeDetails({
  summary: 'Summary',
  body: 'Hidden until someone opens it.',
})

type DetailsRange = { details: DetailsBlock; from: number; source: string; to: number }

function isInsideCode(state: EditorState, position: number) {
  let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(
    position,
    position === 0 ? 1 : -1,
  )
  while (node) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return true
    node = node.parent
  }
  return false
}

/** Scans the document text: a blank line splits an HTML block in two. */
function detailsRanges(state: EditorState): DetailsRange[] {
  const source = state.doc.toString()
  const ranges: DetailsRange[] = []

  for (const match of source.matchAll(ANY_DETAILS)) {
    const from = match.index
    const details = parseDetails(match[0])
    if (from === undefined || !details) continue
    if (isInsideCode(state, from)) continue

    // Only a section on its own line is a block; one embedded in a sentence
    // stays raw HTML, because replacing its lines would hide the sentence.
    const line = state.doc.lineAt(from)
    if (state.sliceDoc(line.from, from).trim()) continue

    ranges.push({ details, from, source: match[0], to: from + match[0].length })
  }

  return ranges
}

export type DetailsEditRequest = {
  details: DetailsBlock
  apply: (next: DetailsBlock) => void
}

class DetailsWidget extends WidgetType {
  private readonly details: DetailsBlock
  private readonly onEdit: (request: DetailsEditRequest) => void
  private readonly source: string

  constructor(
    details: DetailsBlock,
    source: string,
    onEdit: (request: DetailsEditRequest) => void,
  ) {
    super()
    this.details = details
    this.source = source
    this.onEdit = onEdit
  }

  eq(other: DetailsWidget) {
    return other.source === this.source
  }

  get estimatedHeight() {
    return 56
  }

  toDOM(view: EditorView) {
    const document = view.dom.ownerDocument
    const block = document.createElement('div')
    block.className = 'md-details-block'

    const button = document.createElement('button')
    button.className = 'md-details-edit'
    button.type = 'button'
    button.contentEditable = 'false'
    button.textContent = 'Edit section'
    button.title = 'Edit the summary and the content'
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.onEdit({
        details: this.details,
        apply: (next) => replaceDetails(view, this.source, next),
      })
    })

    const details = document.createElement('details')
    details.open = true

    const summary = document.createElement('summary')
    summary.append(...markdownInline(this.details.summary, document))

    const body = document.createElement('div')
    body.className = 'md-details-body'
    const nodes = markdownBlocks(this.details.body, document)
    body.append(...(nodes.length ? nodes : [document.createElement('p')]))

    details.append(summary, body)
    block.append(button, details)
    return block
  }

  ignoreEvent() {
    return false
  }
}

/** Finds the block again at save time: the document may have moved under it. */
function replaceDetails(view: EditorView, source: string, next: DetailsBlock) {
  const current = view.state.doc.toString()
  const at = current.indexOf(source)
  if (at < 0) return

  view.dispatch({
    changes: { from: at, insert: serializeDetails(next), to: at + source.length },
    userEvent: 'input',
  })
}

function buildDecorations(state: EditorState, onEdit: (request: DetailsEditRequest) => void) {
  const decorations: Range<Decoration>[] = []

  for (const range of detailsRanges(state)) {
    const firstLine = state.doc.lineAt(range.from)
    const lastLine = state.doc.lineAt(range.to)

    // A block widget has to cover whole lines; a section always starts its own
    // line, and trailing text after `</details>` is vanishingly rare.
    decorations.push(
      Decoration.replace({
        block: true,
        widget: new DetailsWidget(range.details, range.source, onEdit),
      }).range(firstLine.from, lastLine.to),
    )
  }

  return Decoration.set(decorations, true)
}

/**
 * A block widget replaces whole lines, and CodeMirror only accepts those from
 * a state field — a view plugin may not provide block decorations.
 */
function detailsField(onEdit: (request: DetailsEditRequest) => void) {
  return StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, onEdit),
    update: (value, transaction) =>
      transaction.docChanged ? buildDecorations(transaction.state, onEdit) : value,
    provide: (field) => EditorView.decorations.from(field),
  })
}

const detailsTheme = EditorView.baseTheme({
  '.md-details-block': {
    margin: '1em 0',
    position: 'relative',
    /* CodeMirror lines are `pre-wrap`; block HTML must not render the
       whitespace between its own tags. */
    whiteSpace: 'normal',
  },
  '.md-details-block > details': {
    background: 'var(--bg-secondary, var(--bg-inset))',
    border: '1px solid var(--border-default, var(--border))',
    borderRadius: '8px',
    padding: '8px 14px 10px',
  },
  '.md-details-block summary': {
    color: 'var(--text-primary, var(--fg))',
    cursor: 'pointer',
    fontSize: '0.95rem',
    fontWeight: '600',
    listStyle: 'none',
    position: 'relative',
  },
  '.md-details-block summary::-webkit-details-marker': {
    display: 'none',
  },
  '.md-details-block summary::before': {
    content: '"▾"',
    color: 'var(--text-secondary, var(--fg-faint))',
    fontWeight: '400',
    insetInlineStart: '-14px',
    position: 'absolute',
  },
  '.md-details-block > details:not([open]) summary::before': {
    content: '"▸"',
  },
  '.md-details-body': {
    color: 'var(--text-primary, var(--fg))',
    fontSize: '0.95rem',
    lineHeight: '1.72',
    paddingTop: '2px',
  },
  '.md-details-body > :first-child': {
    marginTop: '0.4em',
  },
  '.md-details-body > :last-child': {
    marginBottom: '0',
  },
  '.md-details-body img': {
    maxWidth: '100%',
    height: 'auto',
  },
  '.md-details-body kbd': {
    background: 'var(--bg-code, var(--bg))',
    border: '1px solid var(--border-strong, var(--border))',
    borderRadius: '4px',
    fontFamily: 'var(--mono)',
    fontSize: '0.8em',
    padding: '1px 5px',
  },
  '.md-details-edit': {
    background: 'var(--bg-primary, var(--bg-elev))',
    border: '1px solid var(--border-default, var(--border))',
    borderRadius: '6px',
    color: 'var(--text-secondary, var(--fg-muted))',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.78em',
    insetInlineEnd: '8px',
    opacity: '0',
    padding: '0.1em 0.5em',
    position: 'absolute',
    top: '6px',
    transition: 'opacity 120ms ease',
    zIndex: '2',
  },
  '.md-details-block:hover .md-details-edit, .md-details-edit:focus-visible': {
    opacity: '1',
  },
  '.md-details-edit:hover': {
    background: 'var(--bg-hover, var(--bg))',
    color: 'var(--text-primary, var(--fg))',
  },
})

export function detailsPlugin(options: {
  onEdit: (request: DetailsEditRequest) => void
}): MarkraPlugin {
  const extension: Extension = [detailsField(options.onEdit), detailsTheme]

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
          const at = view.state.sliceDoc(line.from, line.to).trim() ? line.to : line.from
          const insert = `${at === line.from ? '' : '\n\n'}${DETAILS_TEMPLATE}\n\n`
          view.dispatch({
            changes: { from: at, insert, to: at },
            selection: { anchor: at + insert.indexOf('Summary') + 'Summary'.length },
            scrollIntoView: true,
            userEvent: 'input',
          })
          view.focus()
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
