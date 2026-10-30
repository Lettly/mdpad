import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ancestorsOf, filterTree, isEditable, type TreeNode } from '../lib/tree'

type Props = {
  tree: TreeNode[]
  selectedPath: string | null
  onOpen: (path: string) => void
  truncated: boolean
}

export default function FileTree({ tree, selectedPath, onOpen, truncated }: Props) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)

  const visible = useMemo(() => filterTree(tree, query), [tree, query])

  // Reveal the selected file whenever navigation happens elsewhere.
  useEffect(() => {
    if (!selectedPath) return
    const ancestors = ancestorsOf(selectedPath)
    setCollapsed((previous) => {
      const next = new Set(previous)
      for (const path of ancestors) next.delete(path)
      return next
    })
  }, [selectedPath])

  useEffect(() => {
    const element = listRef.current?.querySelector('[data-selected="true"]')
    element?.scrollIntoView({ block: 'nearest' })
  }, [selectedPath, visible])

  const toggle = (path: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const render = (nodes: TreeNode[], depth: number): ReactNode =>
    nodes.map((node) => {
      const indent = { paddingLeft: `${8 + depth * 12}px` }

      if (node.type === 'dir') {
        const isCollapsed = collapsed.has(node.path)
        return (
          <div key={node.path}>
            <button
              className="tree-row tree-dir"
              style={indent}
              onClick={() => toggle(node.path)}
              title={node.path}
            >
              <span className={isCollapsed ? 'caret' : 'caret caret-open'} aria-hidden="true">
                ▸
              </span>
              <span className="tree-name">{node.name}</span>
            </button>
            {isCollapsed ? null : render(node.children, depth + 1)}
          </div>
        )
      }

      const editable = isEditable(node.path)
      const selected = node.path === selectedPath

      return (
        <button
          key={node.path}
          className={`tree-row tree-file${selected ? ' is-selected' : ''}${editable ? '' : ' is-dim'}`}
          style={indent}
          data-selected={selected || undefined}
          title={editable ? node.path : `${node.path} — not a Markdown file`}
          disabled={!editable}
          onClick={() => onOpen(node.path)}
        >
          <span className="tree-dot" aria-hidden="true" />
          <span className="tree-name">{node.name}</span>
        </button>
      )
    })

  return (
    <aside className="sidebar">
      <div className="sidebar-search">
        <input
          className="input input-compact"
          value={query}
          placeholder="Filter files"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="tree" ref={listRef}>
        {visible.length === 0 ? (
          <p className="tree-empty">{query ? 'No matches.' : 'This repository has no files.'}</p>
        ) : (
          render(visible, 0)
        )}
        {truncated ? (
          <p className="tree-empty">Listing truncated by GitHub — some files are hidden.</p>
        ) : null}
      </div>
    </aside>
  )
}
