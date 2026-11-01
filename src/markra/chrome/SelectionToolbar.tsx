import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Bold,
  Code2,
  Copy,
  Check,
  Eraser,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Strikethrough,
  type LucideIcon,
} from 'lucide-react'
import {
  clearCodeMirrorSelectionFormatting,
  insertCodeMirrorMarkdownLink,
  runMarkraCommand,
} from '@markra/editor/codemirror'
import { useMarkraEditorUi, useMarkraEditorView } from '@markra/editor-react'

/**
 * Markra's floating menu for selected text: the formatting row it shows above a
 * selection, with its heading picker, link and copy actions. mdpad leaves the
 * AI half out — it has no AI to run.
 */

const OFFSET = 12
const VIEWPORT_MARGIN = 12
const TOOLBAR_HEIGHT = 42

type FormatAction = {
  command: string
  icon: LucideIcon
  label: string
}

const FORMAT_ACTIONS: readonly FormatAction[] = [
  { command: 'format.bold', icon: Bold, label: 'Bold' },
  { command: 'format.italic', icon: Italic, label: 'Italic' },
  { command: 'format.strikethrough', icon: Strikethrough, label: 'Strikethrough' },
  { command: 'format.code', icon: Code2, label: 'Inline code' },
  { command: 'format.highlight', icon: Highlighter, label: 'Highlight' },
]

const BLOCK_ACTIONS: readonly FormatAction[] = [
  { command: 'block.quote', icon: Quote, label: 'Quote' },
  { command: 'block.bullet-list', icon: List, label: 'Bullet list' },
  { command: 'block.ordered-list', icon: ListOrdered, label: 'Ordered list' },
]

const HEADING_ICONS: Record<number, LucideIcon> = {
  1: Heading1,
  2: Heading2,
  3: Heading3,
  4: Heading4,
  5: Heading5,
  6: Heading6,
}

const BUTTON =
  'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-(--text-primary) transition-colors duration-150 ease-out hover:bg-(--bg-hover) hover:text-(--text-heading) focus-visible:bg-(--bg-hover) focus-visible:text-(--text-heading) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)'
const BUTTON_ACTIVE = 'bg-(--accent-soft) text-(--accent) hover:bg-(--accent-soft)'
const SEPARATOR = 'mx-0.5 h-5 w-px bg-(--border-default)'

function ToolbarButton({
  active = false,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={`${BUTTON} ${active ? BUTTON_ACTIVE : ''}`}
      onClick={onClick}
      onMouseDown={keepSelection}
      title={label}
      type="button"
    >
      <Icon aria-hidden="true" size={14} />
    </button>
  )
}

/** Mouse focus would blur the editor before the click runs. */
function keepSelection(event: React.MouseEvent) {
  event.preventDefault()
}

export function SelectionToolbar({ children }: { children?: ReactNode }) {
  const view = useMarkraEditorView()
  const selection = view?.state.selection.main ?? null
  const open = Boolean(view && selection && !selection.empty)
  const from = open ? selection!.from : null
  const to = open ? selection!.to : null

  const selectionActions = useMarkraEditorUi('selection-toolbar')
  const blockActions = useMarkraEditorUi('slash-menu')

  // Measured here rather than through the provider's async anchor hook: the
  // menu has to appear on the very first selection, not one transaction later.
  const [anchor, setAnchor] = useState<{ left: number; top: number; bottom: number } | null>(null)

  useLayoutEffect(() => {
    const start = view && from !== null ? view.coordsAtPos(from) : null
    const end = view && to !== null ? view.coordsAtPos(to) : null
    if (!start || !end) {
      setAnchor((current) => (current === null ? current : null))
      return
    }

    const next = {
      left: (start.left + end.right) / 2,
      top: Math.min(start.top, end.top),
      bottom: Math.max(start.bottom, end.bottom),
    }
    setAnchor((current) =>
      current &&
      Math.abs(current.left - next.left) < 0.5 &&
      Math.abs(current.top - next.top) < 0.5 &&
      Math.abs(current.bottom - next.bottom) < 0.5
        ? current
        : next,
    )
  })

  const [headingMenuOpen, setHeadingMenuOpen] = useState(false)
  const [headingMenuPoint, setHeadingMenuPoint] = useState<{ left: number; top: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const headingButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) setHeadingMenuOpen(false)
  }, [open])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1400)
    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!headingMenuOpen) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('.md-heading-menu')) return
      setHeadingMenuOpen(false)
    }
    document.addEventListener('pointerdown', dismiss, true)
    return () => document.removeEventListener('pointerdown', dismiss, true)
  }, [headingMenuOpen])

  const activeCommands = new Set(
    [...selectionActions, ...blockActions].filter((action) => action.active).map((action) => action.command),
  )
  const headingLevel = [1, 2, 3, 4, 5, 6].find((level) => activeCommands.has(`block.heading.${level}`)) ?? null
  const ActiveHeadingIcon = headingLevel ? HEADING_ICONS[headingLevel] : Heading

  if (!view || !open || !anchor) return null

  const placeAbove = anchor.top - OFFSET - TOOLBAR_HEIGHT >= VIEWPORT_MARGIN
  // `translate` (not `transform`) so the entrance animation's transform does
  // not cancel the placement, which is how Markra's own toolbar does it.
  const style: CSSProperties = placeAbove
    ? { left: anchor.left, top: anchor.top - OFFSET, translate: '-50% -100%' }
    : {
        left: anchor.left,
        top: Math.min(anchor.bottom + OFFSET, window.innerHeight - VIEWPORT_MARGIN - TOOLBAR_HEIGHT),
        translate: '-50% 0',
      }

  const run = (command: string) => {
    runMarkraCommand(view, command)
    view.focus()
  }

  const copySelection = () => {
    void navigator.clipboard?.writeText(view.state.sliceDoc(from!, to!))
    setCopied(true)
  }

  return (
    <>
      <section
        aria-label="Formatting"
        className="pointer-events-none fixed z-50 animate-[markra-ai-float-in_160ms_ease-out_both] motion-reduce:animate-none"
        onMouseDown={keepSelection}
        role="toolbar"
        style={style}
      >
        <div className="pointer-events-auto inline-flex max-w-[calc(100vw-24px)] items-center gap-1 overflow-x-auto rounded-lg border border-(--border-default) bg-(--bg-primary) p-1 shadow-(--ai-command-popover-shadow)">
          <button
            aria-expanded={headingMenuOpen}
            aria-haspopup="menu"
            aria-label={headingLevel ? `Heading ${headingLevel}` : 'Block type'}
            className={`${BUTTON} ${headingMenuOpen ? BUTTON_ACTIVE : ''}`}
            onClick={() => {
              const rect = headingButtonRef.current?.getBoundingClientRect()
              setHeadingMenuPoint(rect ? { left: rect.left, top: rect.bottom + 6 } : null)
              setHeadingMenuOpen((value) => !value)
            }}
            ref={headingButtonRef}
            onMouseDown={keepSelection}
            title="Block type"
            type="button"
          >
            <ActiveHeadingIcon aria-hidden="true" size={14} />
          </button>

          <span className={SEPARATOR} aria-hidden="true" />

          {FORMAT_ACTIONS.map((action) => (
            <ToolbarButton
              active={activeCommands.has(action.command)}
              icon={action.icon}
              key={action.command}
              label={action.label}
              onClick={() => run(action.command)}
            />
          ))}
          <ToolbarButton
            icon={Eraser}
            label="Clear formatting"
            onClick={() => {
              clearCodeMirrorSelectionFormatting(view)
              view.focus()
            }}
          />

          <span className={SEPARATOR} aria-hidden="true" />

          {BLOCK_ACTIONS.map((action) => (
            <ToolbarButton
              active={activeCommands.has(action.command)}
              icon={action.icon}
              key={action.command}
              label={action.label}
              onClick={() => run(action.command)}
            />
          ))}

          <span className={SEPARATOR} aria-hidden="true" />

          <ToolbarButton
            icon={Link2}
            label="Link"
            onClick={() => {
              insertCodeMirrorMarkdownLink(view)
              view.focus()
            }}
          />
          <ToolbarButton icon={copied ? Check : Copy} label={copied ? 'Copied' : 'Copy'} onClick={copySelection} />
        </div>
      </section>

      {headingMenuOpen && headingMenuPoint
        ? createPortal(
            <div
              aria-label="Block type"
              className="md-heading-menu pointer-events-auto fixed z-60 grid grid-cols-3 gap-1 rounded-md border border-(--border-default) bg-(--bg-primary) p-1 shadow-(--ai-command-popover-shadow)"
              onMouseDown={keepSelection}
              role="menu"
              style={{
                left: Math.max(
                  VIEWPORT_MARGIN,
                  Math.min(headingMenuPoint.left, window.innerWidth - 132 - VIEWPORT_MARGIN),
                ),
                top: Math.min(headingMenuPoint.top, window.innerHeight - 104 - VIEWPORT_MARGIN),
              }}
            >
              <button
                aria-label="Paragraph"
                className={`${BUTTON} ${headingLevel === null ? BUTTON_ACTIVE : ''}`}
                onClick={() => {
                  setHeadingMenuOpen(false)
                  run('block.paragraph')
                }}
                onMouseDown={keepSelection}
                role="menuitemradio"
                aria-checked={headingLevel === null}
                title="Paragraph"
                type="button"
              >
                <Pilcrow aria-hidden="true" size={15} />
              </button>
              {[1, 2, 3, 4, 5, 6].map((level) => {
                const Icon = HEADING_ICONS[level]
                return (
                  <button
                    aria-checked={headingLevel === level}
                    aria-label={`Heading ${level}`}
                    className={`${BUTTON} ${headingLevel === level ? BUTTON_ACTIVE : ''}`}
                    key={level}
                    onClick={() => {
                      setHeadingMenuOpen(false)
                      run(`block.heading.${level}`)
                    }}
                    onMouseDown={keepSelection}
                    role="menuitemradio"
                    title={`Heading ${level}`}
                    type="button"
                  >
                    <Icon aria-hidden="true" size={15} />
                  </button>
                )
              })}
            </div>,
            document.body,
          )
        : null}

      {children}
    </>
  )
}
