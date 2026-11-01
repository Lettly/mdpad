import DOMPurify from 'dompurify'
import { common, createLowlight } from 'lowlight'
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
 * The output goes through DOMPurify: Markra's own sanitiser only allows the
 * HTML subset a README uses, which would flatten lists and quotes in the body.
 */

export type MarkdownRenderOptions = {
  /** Turns a relative image path into something the browser can load. */
  resolveImageSrc?: (source: string) => string
}

type HastNode = {
  children?: HastNode[]
  properties?: Record<string, unknown>
  tagName?: string
  type: string
  value?: string
}

const lowlight = createLowlight(common)

/* ------------------------------------------------------------- rehype bits */

function element(tagName: string, properties: Record<string, unknown> = {}, children: HastNode[] = []) {
  return { children, properties, tagName, type: 'element' } satisfies HastNode
}

function text(value: string): HastNode {
  return { type: 'text', value }
}

function classNames(node: HastNode): string[] {
  const value = node.properties?.className
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []
}

function walkElements(node: HastNode, visit: (node: HastNode) => void) {
  visit(node)
  for (const child of node.children ?? []) walkElements(child, visit)
}

function textContent(node: HastNode): string {
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(textContent).join('')
}

const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i
const CALLOUT_LABELS: Record<string, string> = {
  caution: 'Caution',
  important: 'Important',
  note: 'Note',
  tip: 'Tip',
  warning: 'Warning',
}

/**
 * `> [!NOTE]` is a GitHub callout. The document around a section renders one
 * through Markra, so a section body should not fall back to a plain quote.
 */
function rehypeCallouts() {
  return (tree: HastNode) => {
    walkElements(tree, (node) => {
      if (node.type !== 'element' || node.tagName !== 'blockquote') return

      // Whitespace between the blockquote tags is a text node of its own.
      const first = node.children?.find((child) => child.type === 'element')
      if (first?.type !== 'element' || first.tagName !== 'p') return
      const marker = first.children?.find((child) => child.type === 'text')
      if (marker?.type !== 'text') return

      const match = CALLOUT.exec(marker.value ?? '')
      if (!match) return

      const type = match[1].toLowerCase()
      marker.value = (marker.value ?? '').slice(match[0].length).replace(/^\n+/, '')
      if (!marker.value.trim()) first.children?.shift()

      node.properties = {
        ...(node.properties ?? {}),
        className: [...classNames(node), 'markra-callout', `markra-callout-${type}`],
      }
      node.children = [
        element('p', { className: ['markra-callout-header'] }, [
          element('span', { className: ['markra-callout-icon'] }),
          element('span', { className: ['markra-callout-title'] }, [text(CALLOUT_LABELS[type] ?? type)]),
        ]),
        ...(node.children ?? []),
      ]
    })
  }
}

/**
 * Fenced code gets the same token colours as the rest of the document. The
 * language label and copy button are added later, on the DOM, where a button
 * can be wired to the clipboard.
 */
function rehypeHighlight() {
  return (tree: HastNode) => {
    walkElements(tree, (node) => {
      if (node.type !== 'element' || node.tagName !== 'pre') return

      const code = node.children?.find((child) => child.type === 'element' && child.tagName === 'code')
      if (!code) return

      const classes = classNames(code)
      const language = classes
        .map((className) => /^language-(.+)$/i.exec(className)?.[1])
        .find((value): value is string => Boolean(value))
      if (!language || !lowlight.registered(language)) return

      try {
        code.children = lowlight.highlight(language, textContent(code)).children
        code.properties = { ...(code.properties ?? {}), className: [...classes, 'hljs'] }
      } catch {
        // An unsupported or broken language still renders as plain code.
      }
    })
  }
}

/* -------------------------------------------------------------- processing */

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  // Raw HTML inside a section is content: `<kbd>`, a centred `<div>`, a nested
  // `<details>`. DOMPurify below decides what actually survives.
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeCallouts)
  .use(rehypeHighlight)
  .use(rehypeKatex)
  .use(rehypeStringify, { allowDangerousHtml: true })

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
    ADD_ATTR: ['align', 'open', 'target'],
  })
}

function toFragment(html: string, document: Document): DocumentFragment {
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content
}

/* ------------------------------------------------------------- enhancement */

function resolveImage(image: HTMLImageElement, document: Document, options: MarkdownRenderOptions) {
  const source = image.getAttribute('src')?.trim() ?? ''
  const resolved = options.resolveImageSrc?.(source) ?? (/^(?:https?:|data:|blob:)/i.test(source) ? source : '')

  if (resolved) {
    image.setAttribute('src', resolved)
    image.setAttribute('loading', 'lazy')
    return
  }

  // A private image that cannot be fetched should not leave a broken icon.
  const fallback = document.createElement('span')
  fallback.className = 'md-details-image-missing'
  fallback.textContent = image.getAttribute('alt')?.trim() || 'Image unavailable'
  image.replaceWith(fallback)
}

function wrapTables(root: ParentNode, document: Document) {
  root.querySelectorAll('table').forEach((table) => {
    if (table.parentElement?.classList.contains('md-details-table')) return
    const wrap = document.createElement('div')
    wrap.className = 'md-details-table'
    table.replaceWith(wrap)
    wrap.append(table)
  })
}

function wrapCodeBlocks(root: ParentNode, document: Document) {
  root.querySelectorAll('pre').forEach((pre) => {
    if (pre.parentElement?.classList.contains('md-details-code')) return

    const code = pre.querySelector('code')
    const language = Array.from(code?.classList ?? [])
      .map((className) => /^language-(.+)$/i.exec(className)?.[1])
      .find(Boolean)

    const frame = document.createElement('div')
    frame.className = 'md-details-code'

    const head = document.createElement('div')
    head.className = 'md-details-code-head'

    const label = document.createElement('span')
    label.className = 'md-details-code-language'
    label.textContent = language ?? 'Code'

    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'md-details-code-copy'
    copy.dataset.mdCopy = pre.textContent ?? ''
    copy.textContent = 'Copy'

    head.append(label, copy)
    pre.replaceWith(frame)
    frame.append(head, pre)
  })
}

/**
 * A nested `<details>` is part of the outer section's body. Its tags survive
 * the Markdown pass, but its summary is still raw Markdown, and the body is
 * not wrapped in the classes the surrounding section uses.
 */
function enhanceNestedDetails(root: ParentNode, document: Document) {
  root.querySelectorAll('details').forEach((details) => {
    details.classList.add('md-details-nested')

    const summary = details.querySelector(':scope > summary')
    if (summary) {
      const source = summary.textContent ?? ''
      summary.replaceChildren()
      const chevron = document.createElement('span')
      chevron.className = 'md-details-chevron'
      chevron.innerHTML =
        '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      const label = document.createElement('span')
      label.className = 'md-details-summary'
      const nodes = markdownInline(source, document)
      if (nodes.length) label.append(...nodes)
      else label.textContent = 'Details'
      summary.append(chevron, label)
    }

    const body = document.createElement('div')
    body.className = 'md-details-body'
    for (const child of Array.from(details.childNodes)) {
      if (child !== summary) body.append(child)
    }
    details.append(body)
  })
}

function enhance(
  root: ParentNode,
  document: Document,
  options: MarkdownRenderOptions,
  mode: 'block' | 'inline',
) {
  root.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href')?.trim() ?? ''
    if (!/^[a-z][a-z\d+.-]*:/i.test(href)) return
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
  })

  root.querySelectorAll('img').forEach((image) => resolveImage(image, document, options))
  if (mode === 'inline') return

  wrapTables(root, document)
  wrapCodeBlocks(root, document)
  enhanceNestedDetails(root, document)
}

/* ------------------------------------------------------------------- public */

/** The body as block content, ready to append into a container. */
export function markdownBlocks(
  markdown: string,
  document: Document,
  options: MarkdownRenderOptions = {},
): Node[] {
  if (!markdown.trim()) return []
  const fragment = toFragment(sanitize(render(markdown)), document)
  enhance(fragment, document, options, 'block')
  return Array.from(fragment.childNodes)
}

/**
 * The summary as inline content: a `<summary>` cannot hold blocks. A heading
 * survives as a styled span, and a list becomes items separated by a dot.
 */
export function markdownInline(markdown: string, document: Document): Node[] {
  if (!markdown.trim()) return []

  const fragment = toFragment(sanitize(render(markdown)), document)
  const container = document.createElement('span')
  container.className = 'md-details-summary-content'

  const append = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      container.append(node.cloneNode())
      return
    }
    if (!(node instanceof HTMLElement)) return

    const tag = node.tagName.toLowerCase()
    if (tag === 'p') {
      Array.from(node.childNodes).forEach(append)
      return
    }
    if (/^h[1-6]$/.test(tag)) {
      const heading = document.createElement('span')
      heading.className = `md-details-summary-heading md-details-summary-h${tag.slice(1)}`
      heading.append(...node.childNodes)
      container.append(heading)
      return
    }
    if (tag === 'ul' || tag === 'ol') {
      Array.from(node.children).forEach((item, index) => {
        if (index > 0) container.append(document.createTextNode(' · '))
        Array.from(item.childNodes).forEach(append)
      })
      return
    }
    if (tag === 'pre') {
      const code = document.createElement('code')
      code.textContent = node.textContent ?? ''
      container.append(code)
      return
    }
    if (tag === 'blockquote' || tag === 'div' || tag === 'section' || tag === 'table') {
      container.append(document.createTextNode(node.textContent ?? ''))
      return
    }
    container.append(node)
  }

  // Iterating the live list while nodes move into the container would skip
  // every sibling after a moved one.
  Array.from(fragment.childNodes).forEach(append)
  enhance(container, document, {}, 'inline')
  return Array.from(container.childNodes)
}
