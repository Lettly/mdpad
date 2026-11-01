import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, type Range } from '@codemirror/state'
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view'

/**
 * Markra styles the first line of a list item and leaves the rest of the item
 * at the page margin, so a wrapped line or a second paragraph reads as prose
 * outside the list. It does the same for nested blockquotes, which all sit on
 * one border. Both are layout, not content: the Markdown stays as written and
 * only the rendered lines move.
 */

type SyntaxNodeLike = { name: string; parent?: unknown }

function nestingDepth(node: SyntaxNodeLike, name: string) {
  let depth = 0
  let parent = node.parent as SyntaxNodeLike | null | undefined
  while (parent) {
    if (parent.name === name) depth += 1
    parent = parent.parent as SyntaxNodeLike | null | undefined
  }
  return depth
}

/** The lines of a range that fall inside the visible window. */
function lineNumbersIn(state: EditorState, from: number, to: number, limitFrom: number, limitTo: number) {
  const numbers: number[] = []
  let at = Math.max(from, limitFrom)
  const end = Math.min(to, limitTo)
  while (at < end) {
    const line = state.doc.lineAt(at)
    numbers.push(line.from)
    if (line.to >= end) break
    at = line.to + 1
  }
  return numbers
}

function buildLayout(view: EditorView) {
  const { state } = view
  const ranges: Range<Decoration>[] = []

  for (const visible of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (node.name === 'ListItem') {
          const depth = nestingDepth(node.node, 'ListItem')
          const itemLine = state.doc.lineAt(node.from).number

          // A nested list indents itself; every other block in the item — a
          // wrapped paragraph, a second paragraph, a quote, code, a table —
          // starts at the item's text, not at the page margin.
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name === 'BulletList' || child.name === 'OrderedList') continue
            for (const lineFrom of lineNumbersIn(state, child.from, child.to, visible.from, visible.to)) {
              if (state.doc.lineAt(lineFrom).number === itemLine) continue
              ranges.push(
                Decoration.line({
                  attributes: { style: `--mdpad-list-depth: ${depth}` },
                  class: 'mdpad-list-continuation',
                }).range(lineFrom),
              )
            }
          }
          return
        }

        if (node.name !== 'Blockquote') return

        const depth = nestingDepth(node.node, 'Blockquote')
        if (depth === 0) return

        // Lines of a nested quote are decorated by that nested node, which is
        // visited later with the deeper value.
        const nested = new Set<number>()
        for (const child of node.node.getChildren('Blockquote')) {
          for (const lineFrom of lineNumbersIn(state, child.from, child.to, visible.from, visible.to)) {
            nested.add(lineFrom)
          }
        }

        for (const lineFrom of lineNumbersIn(state, node.from, node.to, visible.from, visible.to)) {
          if (nested.has(lineFrom)) continue
          ranges.push(
            Decoration.line({
              attributes: { style: `--mdpad-quote-depth: ${depth}` },
              class: 'mdpad-quote-nested',
            }).range(lineFrom),
          )
        }
      },
    })
  }

  return Decoration.set(ranges, true)
}

export function blockLayoutExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildLayout(view)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildLayout(update.view)
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}
