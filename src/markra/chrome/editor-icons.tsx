import {
  Bold,
  CalendarDays,
  ChevronsDownUp,
  ClipboardPaste,
  Code2,
  Copy,
  ExternalLink,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Highlighter,
  Italic,
  Keyboard,
  List,
  ListChecks,
  ListOrdered,
  MessageSquareWarning,
  Minus,
  Pilcrow,
  Scissors,
  SquareCode,
  SquareFunction,
  Strikethrough,
  Superscript,
  Table2,
  TextQuote,
  Upload,
  type LucideIcon,
} from 'lucide-react'

/**
 * Markra names icons in its UI contributions with kebab-case Lucide ids. The
 * slash menu and the context menu render those names, so the set is explicit:
 * importing the whole icon package would put every glyph in the bundle.
 */
const EDITOR_ICONS: Record<string, LucideIcon> = {
  bold: Bold,
  'calendar-days': CalendarDays,
  'chevrons-down-up': ChevronsDownUp,
  'clipboard-paste': ClipboardPaste,
  code: Code2,
  copy: Copy,
  'external-link': ExternalLink,
  'heading-1': Heading1,
  'heading-2': Heading2,
  'heading-3': Heading3,
  'heading-4': Heading4,
  'heading-5': Heading5,
  'heading-6': Heading6,
  highlighter: Highlighter,
  italic: Italic,
  keyboard: Keyboard,
  list: List,
  'list-checks': ListChecks,
  'list-ordered': ListOrdered,
  'message-square-warning': MessageSquareWarning,
  minus: Minus,
  pilcrow: Pilcrow,
  scissors: Scissors,
  'square-code': SquareCode,
  'square-function': SquareFunction,
  strikethrough: Strikethrough,
  superscript: Superscript,
  'table-2': Table2,
  'text-quote': TextQuote,
  upload: Upload,
}

export function EditorIcon({ name, size = 14 }: { name?: string; size?: number }) {
  const Icon = name ? EDITOR_ICONS[name] : undefined
  if (!Icon) return null
  return <Icon aria-hidden="true" size={size} strokeWidth={1.75} />
}
