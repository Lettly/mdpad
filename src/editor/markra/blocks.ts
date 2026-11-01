import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { defineMarkraPlugin, type MarkraPlugin } from '@markra/editor/codemirror'
import { SNIPPETS, snippetPayload } from '../../lib/snippets'

/**
 * The blocks mdpad's toolbar adds that Markra has no command for. Each one is
 * plain Markdown, so it is inserted as text; the live preview renders it.
 */

function isEditable(view: EditorView) {
  return !view.state.facet(EditorState.readOnly)
}

/**
 * Block text goes after the current line, never inside it: a snippet that
 * starts with a blank line would otherwise split the sentence being typed.
 */
export function insertBlockText(view: EditorView, text: string) {
  if (!isEditable(view)) return false

  const { from } = view.state.selection.main
  const line = view.state.doc.lineAt(from)
  const atLineEnd = view.state.sliceDoc(line.from, line.to).trim().length > 0
  const at = atLineEnd ? line.to : line.from
  const insert = atLineEnd ? `\n\n${text.trim()}\n\n` : `${text.trim()}\n\n`

  view.dispatch({
    changes: { from: at, insert, to: at },
    scrollIntoView: true,
    selection: { anchor: at + insert.length },
    userEvent: 'input',
  })
  view.focus()
  return true
}

/** Inline text goes where the caret is, replacing any selection. */
export function insertInlineText(view: EditorView, text: string) {
  if (!isEditable(view)) return false

  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, insert: text, to },
    scrollIntoView: true,
    selection: { anchor: from + text.length },
    userEvent: 'input',
  })
  view.focus()
  return true
}

function insertSnippet(id: string) {
  const snippet = SNIPPETS.find((candidate) => candidate.id === id)
  if (!snippet) return () => false

  const payload = snippetPayload(snippet).trim()
  return (view: EditorView) =>
    snippet.block ? insertBlockText(view, payload) : insertInlineText(view, payload)
}

export function mdpadBlocksPlugin(): MarkraPlugin {
  return defineMarkraPlugin({
    id: 'mdpad.blocks',
    commands: [
      {
        id: 'mdpad.divider',
        isEnabled: isEditable,
        label: 'Divider',
        run: (view) => insertBlockText(view, '---'),
      },
      {
        id: 'mdpad.footnote',
        isEnabled: isEditable,
        label: 'Footnote',
        run: insertSnippet('footnote'),
      },
      {
        id: 'mdpad.math',
        isEnabled: isEditable,
        label: 'Math block',
        run: insertSnippet('math'),
      },
      {
        id: 'mdpad.key',
        isEnabled: isEditable,
        label: 'Keyboard key',
        run: insertSnippet('kbd'),
      },
    ],
    ui: [
      {
        command: 'mdpad.divider',
        group: 'Blocks',
        keywords: ['divider', 'rule', 'horizontal', 'separator'],
        label: 'Divider',
        order: 125,
        placement: 'slash-menu',
      },
      {
        command: 'mdpad.footnote',
        group: 'Blocks',
        keywords: ['footnote', 'reference', 'note'],
        label: 'Footnote',
        order: 140,
        placement: 'slash-menu',
      },
      {
        command: 'mdpad.math',
        group: 'Blocks',
        keywords: ['math', 'latex', 'formula', 'equation'],
        label: 'Math block',
        order: 145,
        placement: 'slash-menu',
      },
      {
        command: 'mdpad.key',
        group: 'Inline',
        keywords: ['key', 'keyboard', 'kbd', 'shortcut'],
        label: 'Keyboard key',
        order: 150,
        placement: 'slash-menu',
      },
    ],
  })
}
