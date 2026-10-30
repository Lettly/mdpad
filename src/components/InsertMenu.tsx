import { useState } from 'react'
import { SNIPPETS } from '../lib/snippets'

type Props = {
  disabled: boolean
  onInsert: (id: string) => void
}

export default function InsertMenu({ disabled, onInsert }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="menu-wrap">
      <button
        className="btn btn-quiet"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        title="Insert a block that rich text cannot make"
      >
        Insert <span className="caret-down">▾</span>
      </button>

      {open ? (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu menu-wide" role="menu">
            {SNIPPETS.map((snippet) => (
              <button
                key={snippet.id}
                className="menu-item menu-item-rich"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onInsert(snippet.id)
                }}
              >
                <span className="menu-label">{snippet.label}</span>
                <span className="menu-hint">{snippet.hint}</span>
              </button>
            ))}
            <p className="menu-foot">Inserted into the Markdown source.</p>
          </div>
        </>
      ) : null}
    </div>
  )
}
