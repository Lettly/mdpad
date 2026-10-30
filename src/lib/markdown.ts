/**
 * GitHub-flavoured Markdown that Toast UI's rich-text mode cannot round-trip.
 * The editor parses Markdown into a ProseMirror document and serialises it back,
 * and a few constructs do not survive that trip:
 *
 *   <details><summary>…  ->  the tags are dropped, the body is flattened
 *   [^1] / [^1]: …       ->  the definition is escaped, so GitHub stops seeing it
 *
 * Everything else in GFM either survives verbatim (tables, task lists, alerts,
 * strikethrough, autolinks, math, emoji shortcodes) or is only cosmetically
 * rewritten (`-` bullets become `*`, table pipes get padded).
 */

// Only real HTML elements count. Documentation is full of placeholders like
// `<user>` or `<owner>` that are not HTML and round-trip fine.
const HTML_TAG =
  /<\/?(details|summary|div|span|pre|table|thead|tbody|tr|td|th|img|br|hr|kbd|sub|sup|picture|video|audio|iframe|style|script|center|font|dl|dt|dd|section|article|aside|nav|figure|figcaption|mark|small|ins|del|p|a|ul|ol|li|h[1-6]|input|label|button|form|svg|path|use|code|em|strong|b|i|u|s|tt|blockquote)\b[^>]*>/i

const HTML_COMMENT = /<!--/
const FOOTNOTE = /\[\^[^\]]+\]/

export type MarkdownRisk = { safe: boolean; reasons: string[] }

/** Code spans and fences are literal text, never HTML or footnotes. */
function stripCode(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '')
}

export function analyzeMarkdown(source: string): MarkdownRisk {
  const prose = stripCode(source)
  const reasons: string[] = []

  if (HTML_TAG.test(prose) || HTML_COMMENT.test(prose)) reasons.push('raw HTML')
  if (FOOTNOTE.test(prose)) reasons.push('footnote syntax')

  return { safe: reasons.length === 0, reasons }
}

export function describeRisk(reasons: string[]): string {
  if (reasons.length <= 1) return reasons[0] ?? 'GitHub-only syntax'
  return `${reasons.slice(0, -1).join(', ')} and ${reasons[reasons.length - 1]}`
}
