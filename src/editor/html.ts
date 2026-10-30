import DOMPurify from 'dompurify'
import { $nodeSchema, $remark, $view } from '@milkdown/utils'
import { htmlSchema } from '@milkdown/preset-commonmark'

/**
 * Markdown carries HTML that has no Markdown equivalent — `<details>` blocks,
 * the centred README header, `<kbd>`, comments. The commonmark preset keeps
 * them as an inline atom; here block-level HTML gets its own block node so it
 * can render as real content instead of a source chip.
 */

type MdNode = { type: string; value?: string; children?: MdNode[] }

/** Block HTML is any `html` node sitting in a block container, not in a paragraph. */
export const remarkHtmlBlocks = $remark('remarkHtmlBlocks', () => () => (tree: MdNode) => {
  const walk = (parent: MdNode) => {
    if (!parent.children) return
    for (const child of parent.children) {
      if (child.type === 'html') child.type = 'htmlBlock'
      else if (child.type !== 'paragraph' && child.type !== 'heading') walk(child)
    }
  }
  walk(tree)
})

export const htmlBlockSchema = $nodeSchema('html_block', () => ({
  group: 'block',
  atom: true,
  defining: true,
  attrs: { value: { default: '' } },
  parseDOM: [
    {
      tag: 'div[data-type="html-block"]',
      getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? '' }),
    },
  ],
  toDOM: (node) => ['div', { 'data-type': 'html-block', 'data-value': node.attrs.value }],
  parseMarkdown: {
    match: ({ type }) => type === 'htmlBlock',
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value as string })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'html_block',
    runner: (state, node) => {
      state.addNode('html', undefined, node.attrs.value)
    },
  },
}))

type EditRequest = { value: string; apply: (next: string) => void }

let requestEdit: ((request: EditRequest) => void) | null = null

export function onHtmlEdit(handler: ((request: EditRequest) => void) | null) {
  requestEdit = handler
}

function renderInto(element: HTMLElement, value: string) {
  element.innerHTML = DOMPurify.sanitize(value, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['align', 'target'],
  })
  element.dataset.value = value
}

export const htmlBlockView = $view(htmlBlockSchema.node, () => (node, view, getPos) => {
  const dom = document.createElement('div')
  dom.className = 'html-block'
  dom.contentEditable = 'false'
  renderInto(dom, node.attrs.value as string)

  dom.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    requestEdit?.({
      value: dom.dataset.value ?? '',
      apply: (next) => {
        const pos = getPos()
        if (typeof pos !== 'number') return
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { value: next }))
      },
    })
  })

  return {
    dom,
    update: (updated) => {
      if (updated.type.name !== 'html_block') return false
      if (updated.attrs.value !== dom.dataset.value) renderInto(dom, updated.attrs.value as string)
      return true
    },
    ignoreMutation: () => true,
    stopEvent: (event) => event.type === 'click',
  }
})

export const htmlInlineView = $view(htmlSchema.node, () => (node) => {
  const dom = document.createElement('span')
  dom.className = 'html-inline'
  dom.contentEditable = 'false'
  renderInto(dom, node.attrs.value as string)

  return {
    dom,
    update: (updated) => {
      if (updated.type.name !== 'html') return false
      if (updated.attrs.value !== dom.dataset.value) renderInto(dom, updated.attrs.value as string)
      return true
    },
    ignoreMutation: () => true,
  }
})
