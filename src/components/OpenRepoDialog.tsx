import { useState } from 'react'
import Modal from './Modal'
import { parseRepoLink } from '../lib/githubUrl'

type Props = {
  initialValue?: string
  onOpen: (owner: string, repo: string, branch?: string, path?: string) => void
  onClose: () => void
}

const EXAMPLES = [
  'github.com/owner/repo',
  'github.com/owner/repo/blob/main/README.md',
]

export default function OpenRepoDialog({ initialValue = '', onOpen, onClose }: Props) {
  const [value, setValue] = useState(initialValue)
  const parsed = parseRepoLink(value)

  const submit = () => {
    if (!parsed) return
    onOpen(parsed.owner, parsed.repo, parsed.branch, parsed.path)
  }

  return (
    <Modal
      title="Open a repository"
      description="Paste a repository or file URL from GitHub."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!parsed}>
            Open
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <input
          className="input"
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder="https://github.com/owner/repo"
          onChange={(event) => setValue(event.target.value)}
          data-autofocus
        />
      </form>
      <div className="dialog-hint">
        {value.trim() === '' ? (
          <ul className="examples">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <code>{example}</code>
              </li>
            ))}
          </ul>
        ) : parsed ? (
          <p className="ok">
            {parsed.owner}/{parsed.repo}
            {parsed.branch ? ` · ${parsed.branch}` : ''}
            {parsed.path ? ` · ${parsed.path}` : ''}
          </p>
        ) : (
          <p className="bad">That does not look like a GitHub repository URL.</p>
        )}
      </div>
    </Modal>
  )
}
