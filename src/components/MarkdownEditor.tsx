import { useEffect, useRef, useState } from 'react'
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
import Modal from './Modal'
import 'katex/dist/katex.min.css'

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
  onChange: (markdown: string) => void
  onSync: (markdown: string) => void
  onReady: (api: EditorApi | null) => void
}

export default function MarkdownEditor({ mode, dark, value, onChange, onSync, onReady }: Props) {
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
  const [htmlEdit, setHtmlEdit] = useState<{ pos: number; value: string } | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let destroyed = false

    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, host)
        ctx.set(defaultValueCtx, '')
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          if (readyRef.current) onChangeRef.current(markdown)
        })
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(clipboard)
      .use(listener)
      .use(math)

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
            if (editorRef.current === editor) onSyncRef.current(editor.action(getMarkdown()))
          }, 0)
        },
        getValue: () => editor.action(getMarkdown()),
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
            const htmlType = state.schema.nodes.html
            const isHtml = markdown.trimStart().startsWith('<') && htmlType
            const tr = isHtml
              ? state.tr.replaceSelectionWith(htmlType.create({ value: markdown.trim() }))
              : state.tr.insertText(markdown)
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

  const openHtml = (event: React.MouseEvent) => {
    const target = (event.target as HTMLElement).closest('span[data-type="html"]')
    const editor = editorRef.current
    if (!target || !editor) return
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const pos = view.posAtDOM(target, 0)
      const node = view.state.doc.nodeAt(pos)
      if (node?.type.name === 'html') setHtmlEdit({ pos, value: node.attrs.value as string })
    })
  }

  const saveHtml = (value: string) => {
    const editor = editorRef.current
    if (!editor || !htmlEdit) return
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const node = view.state.doc.nodeAt(htmlEdit.pos)
      if (!node) return
      view.dispatch(view.state.tr.setNodeMarkup(htmlEdit.pos, undefined, { value }))
    })
    setHtmlEdit(null)
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
            defaultValue=""
            onChange={(event) => {
              const raw = event.target.value
              setHeading(raw === '' ? null : Number(raw))
              event.target.value = ''
            }}
            title="Block type"
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
            onClick={() => run(wrapInBulletListCommand as never)}
            title="Bullet list"
          >
            •
          </button>
          <button
            className="md-btn"
            onClick={() => run(wrapInOrderedListCommand as never)}
            title="Numbered list"
          >
            1.
          </button>
          <button
            className="md-btn"
            onClick={() => run(wrapInBlockquoteCommand as never)}
            title="Quote"
          >
            ❝
          </button>

          <span className="md-sep" />

          <button className="md-btn" onClick={() => run(insertTableCommand as never)} title="Table">
            ▦
          </button>
          <button
            className="md-btn"
            onClick={() => run(createCodeBlockCommand as never)}
            title="Code block"
          >
            {'{ }'}
          </button>
          <button className="md-btn" onClick={() => run(insertHrCommand as never)} title="Divider">
            —
          </button>
          <button className="md-btn" onClick={addLink} title="Link">
            🔗
          </button>
        </div>
      ) : null}

      <div
        className={mode === 'wysiwyg' ? 'md-surface' : 'md-surface is-hidden'}
        ref={hostRef}
        onClick={openHtml}
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
          title="Edit HTML block"
          description="GitHub renders this as written. Click any HTML chip to change it."
          onClose={() => setHtmlEdit(null)}
          footer={
            <>
              <button className="btn" onClick={() => setHtmlEdit(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={() => saveHtml(htmlEdit.value)}>
                Save
              </button>
            </>
          }
        >
          <textarea
            className="input textarea"
            rows={10}
            value={htmlEdit.value}
            spellCheck={false}
            onChange={(event) => setHtmlEdit({ ...htmlEdit, value: event.target.value })}
          />
        </Modal>
      ) : null}
    </div>
  )
}
