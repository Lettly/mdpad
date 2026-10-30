import type { TreeEntry } from './github'

export type TreeNode = {
  name: string
  path: string
  type: 'dir' | 'file'
  children: TreeNode[]
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return collator.compare(a.name, b.name)
  })
  for (const node of nodes) {
    if (node.children.length) sortNodes(node.children)
  }
}

/** Flat git tree -> nested, folders first, alphabetical. */
export function buildTree(entries: TreeEntry[]): TreeNode[] {
  const roots: TreeNode[] = []
  const byPath = new Map<string, TreeNode>()

  for (const entry of entries) {
    if (entry.type !== 'blob') continue

    const parts = entry.path.split('/')
    let level = roots
    let prefix = ''

    for (let i = 0; i < parts.length; i++) {
      prefix = prefix ? `${prefix}/${parts[i]}` : parts[i]
      const isLeaf = i === parts.length - 1

      let node = byPath.get(prefix)
      if (!node) {
        node = {
          name: parts[i],
          path: prefix,
          type: isLeaf ? 'file' : 'dir',
          children: [],
        }
        byPath.set(prefix, node)
        level.push(node)
      }
      if (!isLeaf) level = node.children
    }
  }

  sortNodes(roots)
  return roots
}

export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return nodes

  const walk = (list: TreeNode[]): TreeNode[] => {
    const kept: TreeNode[] = []
    for (const node of list) {
      if (node.type === 'dir') {
        const children = walk(node.children)
        if (children.length > 0) kept.push({ ...node, children })
      } else if (node.path.toLowerCase().includes(needle)) {
        kept.push(node)
      }
    }
    return kept
  }

  return walk(nodes)
}

/** Directory paths that must be expanded to reveal `path`. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split('/').slice(0, -1)
  const out: string[] = []
  let prefix = ''
  for (const part of parts) {
    prefix = prefix ? `${prefix}/${part}` : part
    out.push(prefix)
  }
  return out
}

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx', '.txt']

export function isEditable(path: string): boolean {
  const lower = path.toLowerCase()
  return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension))
}
