import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'

type Props = {
  path: string
  branch: string
  busy: boolean
  error: string | null
  onCommit: (message: string) => void
  onClose: () => void
}

export default function CommitDialog({ path, branch, busy, error, onCommit, onClose }: Props) {
  const [message, setMessage] = useState(`docs: update ${path}`)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const element = inputRef.current
    if (!element) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [])

  const submit = () => {
    if (busy || !message.trim()) return
    onCommit(message.trim())
  }

  return (
    <Modal
      title="Commit to GitHub"
      description={`${path} → ${branch}`}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !message.trim()}>
            {busy ? 'Pushing…' : 'Commit & push'}
          </button>
        </>
      }
    >
      <label className="field">
        <span>Commit message</span>
        <textarea
          ref={inputRef}
          className="input textarea"
          rows={2}
          value={message}
          spellCheck={false}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
      </label>
      {error ? <p className="dialog-error">{error}</p> : null}
      <p className="dialog-note">
        Commits directly to <code>{branch}</code>. No pull request, no branch, no review.
      </p>
    </Modal>
  )
}
