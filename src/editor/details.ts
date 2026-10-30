import { $nodeSchema, $remark, $view } from '@milkdown/utils'
import type { Node as ProseNode } from '@milkdown/prose/model'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

/**
 * A collapsible section whose summary and body are both ordinary Markdown.
 * The summary is an inline node, so bold, italic, code, strikethrough and links
 * work in it; the body is a block node. On save both are written back into
 * `<details><summary>…</summary>…</details>`.
 */

type MdNode = { type: string; value?: string; children?: MdNode[] }

const OPEN = /^<details[^>]*>/i
const SUMMARY = /<summary>([\s\S]*?)<\/summary>/i
const CLOSE = /^\s*<\/details>\s*$/i

const inlineParser = unified().use(remarkParse).use(remarkGfm)

/** Parses a summary line as Markdown, so its marks survive the round-trip. */
function parseInline(text: string): MdNode[] {
  if (!text.trim()) return []
  const tree = inlineParser.parse(text) as unknown as MdNode
  const first = tree.children?.[0]
  return first?.children ?? []
}

const ESCAPE = /[\\`*_[\]<>]/g

/** Serialises one inline run back to Markdown, marks included. */
function serializeInline(node: ProseNode): string {
  const runs: Array<{ text: string; marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[] }> = []

  node.forEach((child) => {
    if (child.type.name === 'hardbreak') {
      runs.push({ text: ' ', marks: [] })
      return
    }

    const text = child.isText ? (child.text ?? '') : child.textContent
    const marks = child.marks as unknown as (typeof runs)[number]['marks']
    const last = runs[runs.length - 1]
    const key = (value: typeof marks) => value.map((mark) => mark.type.name).sort().join(',')

    if (last && key(last.marks) === key(marks)) last.text += text
    else runs.push({ text, marks })
  })

  return runs
    .map(({ text, marks }) => {
      const names = new Set(marks.map((mark) => mark.type.name))
      if (names.has('inlineCode')) return `\`${text}\``

      let out = text.replace(ESCAPE, '\\$&')
      if (names.has('strike_through')) out = `~~${out}~~`
      if (names.has('emphasis')) out = `*${out}*`
      if (names.has('strong')) out = `**${out}**`

      const link = marks.find((mark) => mark.type.name === 'link')
      if (link) {
        const href = String(link.attrs.href ?? '')
        const title = link.attrs.title ? ` "${String(link.attrs.title)}"` : ''
        out = `[${out}](${href}${title})`
      }
      return out
    })
    .join('')
}

/** Folds `<details> … </details>` runs into a single `details` node. */
export const remarkDetails = $remark('remarkDetails', () => () => (tree: MdNode) => {
  const fold = (parent: MdNode) => {
    if (!parent.children) return
    if (parent.type === 'paragraph' || parent.type === 'heading') return

    const out: MdNode[] = []

    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i]

      if (child.type === 'html' && OPEN.test(child.value ?? '')) {
        const value = child.value ?? ''
        const summary = SUMMARY.exec(value)?.[1]?.trim() ?? 'Summary'
        const body: MdNode[] = []
        let j = i + 1
        while (j < parent.children.length) {
          const next = parent.children[j]
          if (next.type === 'html' && CLOSE.test(next.value ?? '')) break
          body.push(next)
          j += 1
        }
        // A saved section may carry an empty-line placeholder instead of a
        // paragraph; drop it and keep one empty paragraph so the body stays
        // clickable and typeable.
        const blocks = body.filter(
          (child) => !(child.type === 'html' && /^<br\s*\/?>$/i.test((child.value ?? '').trim())),
        )
        if (!blocks.length) blocks.push({ type: 'paragraph', children: [] })

        out.push({
          type: 'details',
          children: [
            { type: 'detailsSummary', children: parseInline(summary) },
            { type: 'detailsBody', children: blocks },
          ],
        })
        i = j
        continue
      }

      fold(child)
      out.push(child)
    }

    parent.children = out
  }

  fold(tree)
})

export const detailsSummarySchema = $nodeSchema('details_summary', () => ({
  content: 'inline*',
  defining: true,
  parseDOM: [{ tag: 'div[data-type="details-summary"]' }],
  toDOM: () => ['div', { 'data-type': 'details-summary' }, 0],
  parseMarkdown: {
    match: ({ type }) => type === 'detailsSummary',
    runner: (state, node, type) => {
      state.openNode(type)
      state.next(node.children ?? [])
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'details_summary',
    runner: (state, node) => {
      node.forEach((child) => state.next(child))
    },
  },
}))

export const detailsBodySchema = $nodeSchema('details_body', () => ({
  content: 'block*',
  defining: true,
  parseDOM: [{ tag: 'div[data-type="details-body"]' }],
  toDOM: () => ['div', { 'data-type': 'details-body' }, 0],
  parseMarkdown: {
    match: ({ type }) => type === 'detailsBody',
    runner: (state, node, type) => {
      state.openNode(type)
      state.next(node.children ?? [])
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'details_body',
    runner: (state, node) => {
      node.forEach((child) => {
        // An empty body paragraph would otherwise serialise as `<br />`.
        if (child.type.name === 'paragraph' && child.content.size === 0) return
        state.next(child)
      })
    },
  },
}))

export const detailsSchema = $nodeSchema('details', () => ({
  group: 'block',
  content: 'details_summary details_body',
  defining: true,
  isolating: true,
  parseDOM: [{ tag: 'div[data-type="mdpad-details"]' }],
  toDOM: () => ['div', { 'data-type': 'mdpad-details' }, 0],
  parseMarkdown: {
    match: ({ type }) => type === 'details',
    runner: (state, node, type) => {
      state.openNode(type)
      state.next(node.children ?? [])
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'details',
    runner: (state, node) => {
      const summary = serializeInline(node.child(0))
      state.addNode('html', undefined, `<details>\n<summary>${summary}</summary>`)
      state.next(node.child(1))
      state.addNode('html', undefined, '</details>')
    },
  },
}))

export const detailsSummaryView = $view(detailsSummarySchema.node, () => () => {
  const dom = document.createElement('div')
  dom.className = 'md-details-summary'
  dom.dataset.type = 'details-summary'
  return { dom, contentDOM: dom }
})

export const detailsView = $view(detailsSchema.node, () => () => {
  const dom = document.createElement('div')
  dom.className = 'md-details'
  dom.dataset.type = 'mdpad-details'

  const content = document.createElement('div')
  content.className = 'md-details-content'
  dom.append(content)

  return { dom, contentDOM: content }
})
