import { useEffect, useRef } from 'react'
import Editor from '@toast-ui/editor'
import type { EditorOptions } from '@toast-ui/editor'
import '@toast-ui/editor/dist/toastui-editor.css'
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css'

export type EditorMode = 'wysiwyg' | 'markdown'

export type EditorApi = {
  setValue: (markdown: string) => void
  getValue: () => string
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
  const suppressRef = useRef(false)

  const onChangeRef = useRef(onChange)
  const onSyncRef = useRef(onSync)
  const onReadyRef = useRef(onReady)
  onChangeRef.current = onChange
  onSyncRef.current = onSync
  onReadyRef.current = onReady

  const darkRef = useRef(dark)
  darkRef.current = dark

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const options: EditorOptions = {
      el: host,
      height: '100%',
      initialEditType: 'wysiwyg',
      previewStyle: 'vertical',
      initialValue: '',
      usageStatistics: false,
      autofocus: false,
      theme: darkRef.current ? 'dark' : 'light',
      placeholder: 'Start writing…',
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
      // Ignore the echo produced by setMarkdown/changeMode.
      if (suppressRef.current) return
      onChangeRef.current(editor.getMarkdown())
    }
    editor.on('change', handleChange)

    onReadyRef.current({
      setValue: (markdown) => {
        suppressRef.current = true
        editor.setMarkdown(markdown, false)
        window.setTimeout(() => {
          suppressRef.current = false
          onSyncRef.current(editor.getMarkdown())
        }, 0)
      },
      getValue: () => editor.getMarkdown(),
    })

    return () => {
      editor.off('change')
      editor.destroy()
      editorRef.current = null
      onReadyRef.current(null)
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const current = editor.isMarkdownMode() ? 'markdown' : 'wysiwyg'
    if (current === mode) return

    suppressRef.current = true
    editor.changeMode(mode)
    window.setTimeout(() => {
      suppressRef.current = false
      onSyncRef.current(editor.getMarkdown())
    }, 0)
  }, [mode])

  useEffect(() => {
    const root = hostRef.current?.querySelector('.toastui-editor-defaultUI')
    root?.classList.toggle('toastui-editor-dark', dark)
  }, [dark])

  return <div className="editor-host" ref={hostRef} />
}
