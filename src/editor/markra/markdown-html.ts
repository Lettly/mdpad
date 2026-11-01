import DOMPurify from 'dompurify'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

/**
 * A collapsible section's summary and body are Markdown, but Markra renders
 * raw HTML as static markup — it has no Markdown pass inside it. Rendering the
 * two parts here keeps a section looking like the document around it.
 *
 * Markra's own sanitiser only allows the HTML subset a README uses, which
 * would flatten lists and quotes in the body, so the output goes through
 * DOMPurify instead — the same sanitiser the Milkdown editor used.
 */

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype)
  .use(rehypeKatex)
  .use(rehypeStringify)

const cache = new Map<string, string>()
const CACHE_LIMIT = 50

function render(markdown: string): string {
  const cached = cache.get(markdown)
  if (cached !== undefined) return cached

  const html = String(processor.processSync(markdown))
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(markdown, html)
  return html
}

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    ADD_ATTR: ['align', 'target'],
  })
}

function toNodes(html: string, document: Document): Node[] {
  const template = document.createElement('template')
  template.innerHTML = html
  return Array.from(template.content.childNodes)
}

/** The body as block content, ready to append into a container. */
export function markdownBlocks(markdown: string, document: Document): Node[] {
  if (!markdown.trim()) return []
  return toNodes(sanitize(render(markdown)), document)
}

/** The summary as inline content: a `<summary>` cannot hold blocks. */
export function markdownInline(markdown: string, document: Document): Node[] {
  if (!markdown.trim()) return []

  const template = document.createElement('template')
  template.innerHTML = sanitize(render(markdown))

  const paragraph = template.content.querySelector('p')
  const container = document.createElement('div')
  container.append(
    ...(paragraph ? Array.from(paragraph.childNodes) : Array.from(template.content.childNodes)),
  )

  return toNodes(sanitize(container.innerHTML), document)
}
