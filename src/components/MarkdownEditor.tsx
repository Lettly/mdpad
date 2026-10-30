import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { history } from '@milkdown/plugin-history'
import { clipboard } from '@milkdown/plugin-clipboard'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { math } from '@milkdown/plugin-math'
import { callCommand, getMarkdown, replaceAll } from '@milkdown/utils'
import {
  createCodeBlockCommand,
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  updateLinkCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/preset-commonmark'
import { insertTableCommand, toggleStrikethroughCommand } from '@milkdown/preset-gfm'
import type { CmdKey } from '@milkdown/core'
import { TextSelection } from '@milkdown/prose/state'
import Modal from './Modal'
import { SNIPPETS } from '../lib/snippets'
import {
  detailsBodySchema,
  detailsSchema,
  detailsSummarySchema,
  detailsSummaryView,
  detailsView,
  remarkDetails,
} from '../editor/details'
import {
  htmlBlockSchema,
  htmlBlockView,
  htmlInlineView,
  onHtmlEdit,
  remarkHtmlBlocks,
} from '../editor/html'
import 'katex/dist/katex.min.css'

const DETAILS = /^\s*<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>\s*$/i

/** GitHub callouts are `> [!NOTE]`; remark escapes the bracket on the way out. */
const unescapeCallouts = (markdown: string) =>
  markdown.replace(/^(\s*>\s*)\\\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/gm, '$1[!$2]')

const ICONS: Record<string, ReactElement> = {
  details: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
      <path d="M5.75 6.4L8 8.65l2.25-2.25" />
    </svg>
  ),
  footnote: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.2 12.5V5.4L4 6.6" />
      <circle cx="11.4" cy="4.6" r="1.3" />
    </svg>
  ),
  alert: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.6l5.9 10.8H2.1z" />
      <path d="M8 6.6v3.1" />
      <circle cx="8" cy="11.6" r="0.75" />
    </svg>
  ),
  math: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 3.5h7l-3.6 4.5 3.6 4.5h-7" />
    </svg>
  ),
  kbd: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="4.5" width="13" height="7" rx="1.6" />
      <path d="M4.6 7.2v0M7 7.2v0M9.4 7.2v0M11.8 7.2v0" />
      <path d="M5.2 9.6h5.6" />
    </svg>
  ),
}

export type EditorMode = 'wysiwyg' | 'markdown'

export type EditorApi = {
  setValue: (markdown: string) => void
  getValue: () => string
  setMode: (mode: EditorMode) => void
  insertText: (markdown: string) => void
}

type Props = {
  mode: EditorMode
  dark: boolean
  value: string
  onInsertSnippet: (id: string) => void
  onChange: (markdown: string) => void
  onSync: (markdown: string) => void
  onReady: (api: EditorApi | null) => void
}

export default function MarkdownEditor({ mode, dark, value, onInsertSnippet, onChange, onSync, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const readyRef = useRef(false)

  const onChangeRef = useRef(onChange)
  const onSyncRef = useRef(onSync)
  const onReadyRef = useRef(onReady)
  onChangeRef.current = onChange
  onSyncRef.current = onSync
  onReadyRef.current = onReady

  const modeRef = useRef(mode)
  modeRef.current = mode
  const valueRef = useRef(value)
  valueRef.current = value
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [htmlEdit, setHtmlEdit] = useState<{ value: string; apply: (next: string) => void } | null>(
    null,
  )
  const [details, setDetails] = useState<{ summary: string; body: string } | null>(null)
  const [block, setBlock] = useState<{ level: number | null; inSummary: boolean }>({
    level: null,
    inSummary: false,
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let destroyed = false

    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, host)
        ctx.set(defaultValueCtx, '')
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          if (readyRef.current) onChangeRef.current(unescapeCallouts(markdown))
        })
      })
      // These two run before the commonmark preset, whose own remark pass turns
      // block-level HTML into a paragraph with an inline HTML leaf. Folding
      // <details> and block HTML first keeps them as real block nodes.
      .use(remarkDetails)
      .use(remarkHtmlBlocks)
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(clipboard)
      .use(listener)
      .use(math)
      .use(detailsSummarySchema)
      .use(detailsBodySchema)
      .use(detailsSchema)
      .use(detailsSummaryView)
      .use(detailsView)
      .use(htmlBlockSchema)
      .use(htmlBlockView)
      .use(htmlInlineView)

    editorRef.current = editor

    void editor.create().then(() => {
      if (destroyed) {
        editor.destroy()
        return
      }
      readyRef.current = true
      onReadyRef.current({
        setValue: (markdown) => {
          void editor.action(replaceAll(markdown))
          // Hand the serialised form back as the baseline, so the dirty check
          // starts from the text the editor will actually save.
          window.setTimeout(() => {
            if (editorRef.current === editor) onSyncRef.current(unescapeCallouts(editor.action(getMarkdown())))
          }, 0)
        },
        getValue: () => unescapeCallouts(editor.action(getMarkdown())),
        setMode: () => undefined,
        insertText: (markdown) => {
          if (modeRef.current === 'markdown') {
            const field = textareaRef.current
            const current = valueRef.current
            const start = field?.selectionStart ?? current.length
            const end = field?.selectionEnd ?? start
            onChangeRef.current(current.slice(0, start) + markdown + current.slice(end))
            const caret = start + markdown.length
            window.requestAnimationFrame(() => {
              field?.focus()
              field?.setSelectionRange(caret, caret)
            })
            return
          }

          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            const { state } = view
            const detailsType = state.schema.nodes.details
            const summaryType = state.schema.nodes.details_summary
            const bodyType = state.schema.nodes.details_body
            const htmlType = state.schema.nodes.html
            const trimmed = markdown.trimStart()

            let tr
            if (/^<details/i.test(trimmed) && detailsType && summaryType && bodyType) {
              const at = state.selection.from
              const summary = summaryType.create(null, state.schema.text('Summary'))
              const body = bodyType.create(null, state.schema.nodes.paragraph.create())
              const node = detailsType.create(null, [summary, body])
              tr = state.tr.replaceSelectionWith(node)

              // Select the placeholder so the first thing typed replaces it.
              let detailsPos: number | null = null
              const from = Math.max(0, at - 1)
              const to = Math.min(tr.doc.content.size, at + node.nodeSize + 1)
              tr.doc.nodesBetween(from, to, (candidate, pos) => {
                if (candidate.type.name === 'details') {
                  detailsPos = pos
                  return false
                }
                return true
              })

              const start = detailsPos === null ? null : detailsPos + 2
              if (start !== null) {
                try {
                  tr.setSelection(TextSelection.create(tr.doc, start, start + 'Summary'.length))
                } catch {
                  tr.setSelection(TextSelection.near(tr.doc.resolve(start), 1))
                }
              }
            } else if (trimmed.startsWith('<') && htmlType) {
              tr = state.tr.replaceSelectionWith(htmlType.create({ value: markdown.trim() }))
            } else {
              tr = state.tr.insertText(markdown)
            }
            view.dispatch(tr.scrollIntoView())
            view.focus()
          })
        },
      })
    })

    return () => {
      destroyed = true
      readyRef.current = false
      editorRef.current = null
      onReadyRef.current(null)
      editor.destroy()
    }
  }, [])

  useEffect(() => {
    const root = hostRef.current?.querySelector('.milkdown')
    root?.classList.toggle('md-dark', dark)
  }, [dark])

  useEffect(() => {
    let frame = 0

    const syncBlock = () => {
      // ProseMirror's own selection listener is registered after this one, so
      // read the state on the next frame, once it has caught up.
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(readBlock)
    }

    const readBlock = () => {
      const editor = editorRef.current
      if (!editor) return
      try {
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const { $from } = view.state.selection
          let inSummary = false
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            if ($from.node(depth).type.name === 'details_summary') {
              inSummary = true
              break
            }
          }
          const parent = $from.parent
          const level = parent.type.name === 'heading' ? (parent.attrs.level as number) : null
          setBlock((current) =>
            current.level === level && current.inSummary === inSummary
              ? current
              : { level, inSummary },
          )
        })
      } catch {
        /* the editor is between states; the next selection change settles it */
      }
    }

    document.addEventListener('selectionchange', syncBlock)
    syncBlock()
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', syncBlock)
    }
  }, [])

  useEffect(() => {
    onHtmlEdit((request) => {
      const parts = DETAILS.exec(request.value)
      setDetails(parts ? { summary: parts[1].trim(), body: parts[2].trim() } : null)
      setHtmlEdit(request)
    })
    return () => onHtmlEdit(null)
  }, [])

  const saveHtml = (value: string) => {
    htmlEdit?.apply(value)
    setHtmlEdit(null)
    setDetails(null)
  }

  const closeHtml = () => {
    setHtmlEdit(null)
    setDetails(null)
  }

  const run = (command: { key: CmdKey<unknown> }, payload?: unknown) => {
    const editor = editorRef.current
    if (!editor) return
    editor.action(callCommand(command.key, payload as never))
  }

  const setHeading = (level: number | null) => {
    if (level === null) run(turnIntoTextCommand as unknown as { key: CmdKey<unknown> })
    else run(wrapInHeadingCommand as unknown as { key: CmdKey<unknown> }, level)
  }

  const addLink = () => {
    const href = window.prompt('Link URL')
    if (href) run(updateLinkCommand as unknown as { key: CmdKey<unknown> }, { href })
  }

  return (
    <div className="editor-host">
      {mode === 'wysiwyg' ? (
        <div className="md-toolbar">
          <select
            className="md-select"
            value={block.level ? String(block.level) : ''}
            disabled={block.inSummary}
            onChange={(event) => setHeading(event.target.value === '' ? null : Number(event.target.value))}
            title={block.inSummary ? 'A section summary is inline text; headings do not apply' : 'Block type'}
          >
            <option value="">Text</option>
            <option value="1">Heading 1</option>
            <option value="2">Heading 2</option>
            <option value="3">Heading 3</option>
          </select>

          <span className="md-sep" />

          <button className="md-btn" onClick={() => run(toggleStrongCommand as never)} title="Bold">
            <strong>B</strong>
          </button>
          <button className="md-btn" onClick={() => run(toggleEmphasisCommand as never)} title="Italic">
            <em>I</em>
          </button>
          <button
            className="md-btn"
            onClick={() => run(toggleStrikethroughCommand as never)}
            title="Strikethrough"
          >
            <s>S</s>
          </button>
          <button
            className="md-btn"
            onClick={() => run(toggleInlineCodeCommand as never)}
            title="Inline code"
          >
            {'<>'}
          </button>

          <span className="md-sep" />

          <button
            className="md-btn"
            disabled={block.inSummary}
            onClick={() => run(wrapInBulletListCommand as never)}
            title="Bullet list"
          >
            •
          </button>
          <button
            className="md-btn"
            disabled={block.inSummary}
            onClick={() => run(wrapInOrderedListCommand as never)}
            title="Numbered list"
          >
            1.
          </button>
          <button
            className="md-btn"
            disabled={block.inSummary}
            onClick={() => run(wrapInBlockquoteCommand as never)}
            title="Quote"
          >
            ❝
          </button>

          <span className="md-sep" />

          <button
            className="md-btn"
            disabled={block.inSummary}
            onClick={() => run(insertTableCommand as never)}
            title="Table"
          >
            ⊞
          </button>
          <button
            className="md-btn"
            disabled={block.inSummary}
            onClick={() => run(createCodeBlockCommand as never)}
            title="Code block"
          >
            {'{ }'}
          </button>
          <button
            className="md-btn"
            disabled={block.inSummary}
            onClick={() => run(insertHrCommand as never)}
            title="Divider"
          >
            —
          </button>
          <button className="md-btn" onClick={addLink} title="Link">
            🔗
          </button>

          <span className="md-sep" />

          <div className="md-chips">
            {SNIPPETS.map((snippet) => (
              <button
                key={snippet.id}
                className="md-chip"
                disabled={block.inSummary}
                onClick={() => onInsertSnippet(snippet.id)}
                title={block.inSummary ? 'Not available inside a section summary' : snippet.label}
                aria-label={snippet.label}
              >
                {ICONS[snippet.id]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div
        className={mode === 'wysiwyg' ? 'md-surface' : 'md-surface is-hidden'}
        ref={hostRef}
      />

      {mode === 'markdown' ? (
        <textarea
          ref={textareaRef}
          className="raw-editor"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}

      {htmlEdit ? (
        <Modal
          title={details ? 'Collapsible section' : 'Edit HTML block'}
          description={
            details
              ? 'Shown on GitHub as a disclosure.'
              : 'GitHub renders this as written. Click any rendered block to change it.'
          }
          onClose={closeHtml}
          footer={
            <>
              <button className="btn" onClick={closeHtml}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() =>
                  saveHtml(
                    details
                      ? `<details>\n<summary>${details.summary}</summary>\n\n${details.body}\n\n</details>`
                      : htmlEdit.value,
                  )
                }
              >
                Save
              </button>
            </>
          }
        >
          {details ? (
            <>
              <label className="field">
                <span>Summary</span>
                <input
                  className="input"
                  value={details.summary}
                  onChange={(event) => setDetails({ ...details, summary: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Content</span>
                <textarea
                  className="input textarea"
                  rows={6}
                  value={details.body}
                  onChange={(event) => setDetails({ ...details, body: event.target.value })}
                />
              </label>
            </>
          ) : (
            <textarea
              className="input textarea"
              rows={10}
              value={htmlEdit.value}
              spellCheck={false}
              onChange={(event) => setHtmlEdit({ ...htmlEdit, value: event.target.value })}
            />
          )}
        </Modal>
      ) : null}
    </div>
  )
}
