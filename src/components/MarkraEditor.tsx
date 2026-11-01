import { Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { replaceCodeMirrorMarkdown, runMarkraCommand } from '@markra/editor/codemirror'
import { MarkraEditorProvider } from '@markra/editor-react'
import { CodeMirrorPaperSurface } from '../markra/chrome/CodeMirrorPaperSurface'
import { SelectionToolbar } from '../markra/chrome/SelectionToolbar'
import { detailsPlugin, resetDetailsState } from '../editor/markra/details'
import { insertBlockText, insertInlineText, mdpadBlocksPlugin } from '../editor/markra/blocks'
import { resolveImage, resolveRepoPath, type ImageLocation } from '../lib/images'

export type EditorMode = 'wysiwyg' | 'markdown'

export type EditorApi = {
  setValue: (markdown: string) => void
  getValue: () => string
  setMode: (mode: EditorMode) => void
  insertText: (markdown: string) => void
  run: (command: string) => void
  focus: () => void
}

type Props = {
  mode: EditorMode
  theme: 'light' | 'dark'
  /** Where the document lives, so relative image paths can be resolved. */
  imageLocation?: ImageLocation
  value: string
  onChange: (markdown: string) => void
  onSync: (markdown: string) => void
  onReady: (api: EditorApi | null) => void
}

/** Markra's paper shell: the same wrappers, utilities and spacing as its app. */
const PAPER_STYLE = {
  '--editor-body-font-size': '16px',
  '--editor-paragraph-spacing': '8px',
  fontSize: '16px',
  lineHeight: 1.65,
  maxWidth: '860px',
} as CSSProperties

export default function MarkraEditor({
  mode,
  theme,
  imageLocation,
  value,
  onChange,
  onSync,
  onReady,
}: Props) {
  const viewRef = useRef<EditorView | null>(null)
  const [editorView, setEditorView] = useState<EditorView | null>(null)

  const onChangeRef = useRef(onChange)
  const onSyncRef = useRef(onSync)
  const onReadyRef = useRef(onReady)
  onChangeRef.current = onChange
  onSyncRef.current = onSync
  onReadyRef.current = onReady

  const imageLocationRef = useRef(imageLocation)
  imageLocationRef.current = imageLocation

  const valueRef = useRef(value)
  valueRef.current = value
  const modeRef = useRef(mode)
  modeRef.current = mode
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Renderers only re-run on a document change, so a private image that arrives
  // after the first paint needs a nudge that leaves the text and undo untouched.
  const refreshImages = useCallback(() => {
    const view = viewRef.current
    if (!view || view.state.doc.length === 0 || view.composing) return

    const quiet = Transaction.addToHistory.of(false)
    view.dispatch({ annotations: quiet, changes: { from: 0, insert: ' ' } })
    view.dispatch({ annotations: quiet, changes: { from: 0, insert: '', to: 1 } })
  }, [])

  const resolveImageSrc = useCallback(
    (source: string) => {
      const location = imageLocationRef.current
      // No repository yet: absolute URLs still work, everything else stays
      // as source rather than as a broken image.
      if (!location) return /^(?:https?:|data:|blob:)/i.test(source.trim()) ? source : ''
      return resolveImage(location, source, refreshImages) ?? ''
    },
    [refreshImages],
  )

  // A link inside a section body cannot go through the editor's link plugin:
  // it is rendered DOM, not Markdown text. External links open in a tab, and a
  // relative path opens its page on GitHub, where the branch is correct.
  const resolveDetailsLink = useCallback((href: string) => {
    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) return href
    if (href.startsWith('#')) return null

    const location = imageLocationRef.current
    if (!location) return null

    const path = resolveRepoPath(location.documentPath, href)
    if (!path) return null

    const encoded = path.split('/').map(encodeURIComponent).join('/')
    return `https://github.com/${location.owner}/${location.repo}/blob/${encodeURIComponent(location.branch)}/${encoded}`
  }, [])

  const openDetailsLink = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  // Markra's plugins are built into its surface; mdpad only adds the ones it
  // owns: collapsible sections and the extra block commands.
  const plugins = useRef([
    detailsPlugin({
      openExternalUrl: openDetailsLink,
      resolveImageSrc,
      resolveLinkHref: resolveDetailsLink,
    }),
    mdpadBlocksPlugin(),
  ]).current

  useEffect(
    () => () => {
      viewRef.current = null
      resetDetailsState()
      onReadyRef.current(null)
    },
    [],
  )

  const handleReady = (view: EditorView | null) => {
    viewRef.current = view
    setEditorView(view)
    if (!view) {
      onReadyRef.current(null)
      return
    }

    onReadyRef.current({
      setValue: (markdown) => {
        resetDetailsState()
        replaceCodeMirrorMarkdown(view, markdown)
        // The editor edits the Markdown source directly, so the document is
        // already what a save would write: adopt it as the clean baseline.
        onSyncRef.current(markdown)
      },
      getValue: () =>
        modeRef.current === 'markdown' ? valueRef.current : view.state.doc.toString(),
      setMode: () => undefined,
      insertText: (markdown) => {
        // In Markdown mode the textarea is the document: the hidden editor
        // still holds the text from before the switch, so writing there would
        // both lose the snippet and publish a stale document.
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

        if (markdown.startsWith('\n\n')) insertBlockText(view, markdown)
        else insertInlineText(view, markdown)
      },
      run: (command) => {
        runMarkraCommand(view, command)
      },
      focus: () => view.focus(),
    })
  }

  return (
    <div className="editor-host markra-root" data-theme={theme}>
      <MarkraEditorProvider view={editorView}>
        <section
          aria-label="Writing surface"
          className="paper-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-none bg-transparent"
          style={{ display: mode === 'wysiwyg' ? undefined : 'none' }}
        >
          <article
            className="markdown-paper relative mx-auto min-h-screen w-full max-w-215 px-18 pt-14 text-[16px] leading-[1.65] text-(--text-primary) caret-(--accent) outline-none focus:outline-none max-[900px]:px-5.25 max-[900px]:pt-10"
            data-editor-engine="codemirror"
            data-editor-theme={theme}
            style={PAPER_STYLE}
          >
            <CodeMirrorPaperSurface
              autoFocus
              extendedSyntax={{ githubAlerts: true, highlight: true }}
              initialContent={valueRef.current}
              language="en"
              onEditorReady={handleReady}
              onMarkdownChange={(markdown) => onChangeRef.current(markdown)}
              openExternalUrl={openDetailsLink}
              paragraphSpacingPx={8}
              plugins={plugins}
              resolveImageSrc={resolveImageSrc}
              rawHtmlSkip={(source) => /^<\/?details\b/i.test(source.trim())}
              showCodeBlockLineNumbers={false}
              tableColumnWidthMode="auto"
            />
          </article>
        </section>
        {mode === 'wysiwyg' ? <SelectionToolbar /> : null}
      </MarkraEditorProvider>

      {mode === 'markdown' ? (
        <textarea
          ref={textareaRef}
          className="raw-editor"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
    </div>
  )
}
