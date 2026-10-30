import { $nodeSchema, $remark, $view } from '@milkdown/utils'

/**
 * A real collapsible-section node: the summary is edited in place, and the body
 * is ordinary Markdown blocks — so lists, code, links and images inside a
 * `<details>` are editable like anything else.
 */

type MdNode = { type: string; value?: string; children?: MdNode[]; summary?: string }

const OPEN = /^<details[^>]*>/i
const SUMMARY = /<summary>([\s\S]*?)<\/summary>/i
const CLOSE = /^\s*<\/details>\s*$/i

/** Folds `<details> … </details>` runs into a single `details` node. */
export const remarkDetails = $remark('remarkDetails', () => () => (tree: MdNode) => {
  const fold = (parent: MdNode) => {
    if (!parent.children) return
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
        out.push({ type: 'details', summary, children: [{ type: 'detailsBody', children: body }] })
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

export const detailsBodySchema = $nodeSchema('details_body', () => ({
  content: 'block+',
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
      node.forEach((child) => state.next(child))
    },
  },
}))

export const detailsSchema = $nodeSchema('details', () => ({
  group: 'block',
  content: 'details_body',
  defining: true,
  attrs: { summary: { default: 'Summary' } },
  parseDOM: [
    {
      tag: 'details[data-type="mdpad-details"]',
      getAttrs: (dom) => ({ summary: (dom as HTMLElement).dataset.summary ?? 'Summary' }),
    },
  ],
  toDOM: (node) => [
    'details',
    { 'data-type': 'mdpad-details', 'data-summary': node.attrs.summary, open: 'true' },
    0,
  ],
  parseMarkdown: {
    match: ({ type }) => type === 'details',
    runner: (state, node, type) => {
      state.openNode(type, { summary: (node as MdNode).summary ?? 'Summary' })
      state.next(node.children ?? [])
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'details',
    runner: (state, node) => {
      state.addNode('html', undefined, `<details>\n<summary>${node.attrs.summary}</summary>`)
      state.next(node.child(0))
      state.addNode('html', undefined, '</details>')
    },
  },
}))

export const detailsView = $view(detailsSchema.node, () => (node, view, getPos) => {
  const dom = document.createElement('details')
  dom.open = true
  dom.className = 'md-details'

  const summary = document.createElement('summary')
  const input = document.createElement('input')
  input.className = 'md-details-summary'
  input.value = node.attrs.summary as string
  input.setAttribute('aria-label', 'Section summary')
  input.addEventListener('input', () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { summary: input.value }))
  })
  input.addEventListener('mousedown', (event) => event.stopPropagation())
  summary.append(input)

  const body = document.createElement('div')
  body.className = 'md-details-body'

  dom.append(summary, body)

  return {
    dom,
    contentDOM: body,
    update: (updated) => {
      if (updated.type.name !== 'details') return false
      if (updated.attrs.summary !== input.value) input.value = updated.attrs.summary as string
      return true
    },
    ignoreMutation: (mutation) => !body.contains(mutation.target as Node),
    stopEvent: (event) => input.contains(event.target as Node),
  }
})
