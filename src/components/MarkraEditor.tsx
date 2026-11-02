import { Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { replaceCodeMirrorMarkdown, runMarkraCommand } from '@markra/editor/codemirror'
import { MarkraEditorProvider } from '@markra/editor-react'
import { CodeMirrorPaperSurface } from '../markra/chrome/CodeMirrorPaperSurface'
import { SelectionToolbar } from '../markra/chrome/SelectionToolbar'
import { detailsPlugin, resetDetailsState } from '../editor/markra/details'
import { insertBlockText, insertInlineText, mdpadBlocksPlugin } from '../editor/markra/blocks'
import { mdpadUploadPlugin } from '../editor/markra/upload'
import { resolveImage, type ImageLocation } from '../lib/images'

export type EditorMode = 'wysiwyg' | 'markdown'

/** The `src` of an `<img …>` tag kept as source by the raw HTML renderer. */
function inlineHtmlImageSource(markup: string): string | null {
  const match = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(markup)
  const value = (match?.[1] ?? match?.[2] ?? match?.[3])?.trim()
  return value || null
}

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
  /** Opens the upload dialog from the editor's slash and right-click menus. */
  onUpload: () => void
  /** Opens a link written in the document; mdpad maps it onto the repository. */
  onOpenLink?: (href: string) => void
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
  onUpload,
  onOpenLink,
}: Props) {
  const viewRef = useRef<EditorView | null>(null)
  const [editorView, setEditorView] = useState<EditorView | null>(null)

  const onChangeRef = useRef(onChange)
  const onSyncRef = useRef(onSync)
  const onReadyRef = useRef(onReady)
  const onUploadRef = useRef(onUpload)
  onChangeRef.current = onChange
  onSyncRef.current = onSync
  onReadyRef.current = onReady
  onUploadRef.current = onUpload

  const onOpenLinkRef = useRef(onOpenLink)
  onOpenLinkRef.current = onOpenLink

  const imageLocationRef = useRef(imageLocation)
  imageLocationRef.current = imageLocation

  const valueRef = useRef(value)
  valueRef.current = value
  const modeRef = useRef(mode)
  modeRef.current = mode
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const refreshImagesRef = useRef<() => void>(() => {})

  // Renderers only re-run on a document change, so a private image that arrives
  // after the first paint needs a nudge that leaves the text and undo untouched.
  // Inline HTML keeps its widget when only the resolved image changed, so those
  // elements are filled in directly.
  const refreshImages = useCallback(() => {
    const view = viewRef.current
    if (!view || view.state.doc.length === 0 || view.composing) return

    const quiet = Transaction.addToHistory.of(false)
    view.dispatch({ annotations: quiet, changes: { from: 0, insert: ' ' } })
    view.dispatch({ annotations: quiet, changes: { from: 0, insert: '', to: 1 } })

    const location = imageLocationRef.current
    if (!location) return

    for (const image of view.contentDOM.querySelectorAll<HTMLImageElement>('img')) {
      if (image.getAttribute('src')) continue
      const markup =
        image.dataset.value ?? image.closest<HTMLElement>('[data-value]')?.dataset.value
      const source = inlineHtmlImageSource(markup ?? '')
      if (!source) continue
      const resolved = resolveImage(location, source, () => refreshImagesRef.current())
      if (resolved) image.src = resolved
    }
  }, [])

  refreshImagesRef.current = refreshImages

  const resolveImageSrc = useCallback((source: string) => {
    const location = imageLocationRef.current
    // No repository yet: absolute URLs still work, everything else stays
    // as source rather than as a broken image.
    if (!location) return /^(?:https?:|data:|blob:)/i.test(source.trim()) ? source : ''
    return resolveImage(location, source, () => refreshImagesRef.current()) ?? ''
  }, [])

  // Links come out of the document as written, so the app decides where they
  // go: a repository path is opened here or on GitHub, a URL in a new tab.
  const openDocumentLink = useCallback((href: string) => {
    if (onOpenLinkRef.current) {
      onOpenLinkRef.current(href)
      return
    }
    if (/^(?:https?:|mailto:|tel:)/i.test(href) || href.startsWith('//')) {
      window.open(href, '_blank', 'noopener,noreferrer')
    }
  }, [])

  // Markra's plugins are built into its surface; mdpad only adds the ones it
  // owns: collapsible sections, the extra block commands, and uploads.
  const plugins = useRef([
    detailsPlugin({
      openExternalUrl: openDocumentLink,
      openLink: openDocumentLink,
      resolveImageSrc,
    }),
    mdpadBlocksPlugin(),
    mdpadUploadPlugin({ onUpload: () => onUploadRef.current() }),
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
              openExternalUrl={openDocumentLink}
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
