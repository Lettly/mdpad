import { useEffect, useRef } from 'react'
import Editor from '@toast-ui/editor'
import type { EditorOptions } from '@toast-ui/editor'
import DOMPurify from 'dompurify'
import '@toast-ui/editor/dist/toastui-editor.css'
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css'

export type EditorMode = 'wysiwyg' | 'markdown'

export type EditorApi = {
  setValue: (markdown: string) => void
  getValue: () => string
  /** Switches mode without reporting the conversion back as an edit. */
  setMode: (mode: EditorMode) => void
}

type Props = {
  mode: EditorMode
  dark: boolean
  onChange: (markdown: string) => void
  /** Called with the editor's own serialisation, so the baseline matches it. */
  onSync: (markdown: string) => void
  onReady: (api: EditorApi | null) => void
}

export default function MarkdownEditor({ mode, dark, onChange, onSync, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)

  // Conversions and programmatic loads fire the same `change` event as typing.
  // Suppressions nest (setMode then setValue), so count them instead of using
  // a boolean that a second call could clear too early.
  const suppressRef = useRef(0)
  const beginSuppress = () => {
    suppressRef.current += 1
  }
  const endSuppress = () => {
    suppressRef.current = Math.max(0, suppressRef.current - 1)
  }

  const onChangeRef = useRef(onChange)
  const onSyncRef = useRef(onSync)
  const onReadyRef = useRef(onReady)
  onChangeRef.current = onChange
  onSyncRef.current = onSync
  onReadyRef.current = onReady

  const darkRef = useRef(dark)
  darkRef.current = dark
  const modeRef = useRef(mode)
  modeRef.current = mode

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const options: EditorOptions = {
      el: host,
      height: '100%',
      // The first file decides the mode: a Markdown-only file must never be
      // parsed as rich text, even for an instant.
      initialEditType: modeRef.current,
      previewStyle: 'vertical',
      initialValue: '',
      usageStatistics: false,
      autofocus: false,
      theme: darkRef.current ? 'dark' : 'light',
      placeholder: 'Start writing…',
      hideModeSwitch: true,
      // Markdown from someone else's repository is untrusted input: it must not
      // be able to run script in a page that holds a GitHub token.
      customHTMLSanitizer: (html) =>
        DOMPurify.sanitize(html, {
          USE_PROFILES: { html: true },
          ADD_ATTR: ['target', 'align', 'colspan', 'rowspan'],
        }),
      toolbarItems: [
        ['heading', 'bold', 'italic', 'strike'],
        ['hr', 'quote'],
        ['ul', 'ol', 'task', 'indent', 'outdent'],
        ['table', 'image', 'link'],
        ['code', 'codeblock'],
      ],
    }

    const editor = new Editor(options)
    editorRef.current = editor

    const handleChange = () => {
      if (suppressRef.current > 0) return
      onChangeRef.current(editor.getMarkdown())
    }
    editor.on('change', handleChange)

    onReadyRef.current({
      setValue: (markdown) => {
        beginSuppress()
        editor.setMarkdown(markdown, false)
        window.setTimeout(() => {
          endSuppress()
          if (editorRef.current === editor) onSyncRef.current(editor.getMarkdown())
        }, 0)
      },
      getValue: () => editor.getMarkdown(),
      setMode: (next) => {
        const current = editor.isMarkdownMode() ? 'markdown' : 'wysiwyg'
        if (current === next) return
        beginSuppress()
        editor.changeMode(next)
        window.setTimeout(endSuppress, 0)
      },
    })

    return () => {
      editor.off('change')
      editor.destroy()
      editorRef.current = null
      // Toast UI's destroy() leaves its DOM behind, which would stack a second
      // editor on top of the first one after a StrictMode remount.
      host.innerHTML = ''
      onReadyRef.current(null)
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const current = editor.isMarkdownMode() ? 'markdown' : 'wysiwyg'
    if (current === mode) return

    beginSuppress()
    editor.changeMode(mode)
    window.setTimeout(() => {
      endSuppress()
      if (editorRef.current === editor) onSyncRef.current(editor.getMarkdown())
    }, 0)
  }, [mode])

  useEffect(() => {
    const root = hostRef.current?.querySelector('.toastui-editor-defaultUI')
    root?.classList.toggle('toastui-editor-dark', dark)
  }, [dark])

  return <div className="editor-host" ref={hostRef} />
}
