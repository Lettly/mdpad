import { useMemo, useRef, useState } from 'react'
import Modal from './Modal'
import { MAX_UPLOAD_BYTES } from '../lib/github'
import { directoryPaths, filePaths, type TreeNode } from '../lib/tree'
import {
  buildItems,
  folderOf,
  formatSize,
  isImageName,
  isValidFolder,
  markdownForUpload,
  normalizeFolder,
  type UploadItem,
} from '../lib/upload'

type Props = {
  files: File[]
  tree: TreeNode[]
  documentPath: string
  busy: boolean
  error: string | null
  onUpload: (items: UploadItem[], message: string) => void
  onClose: () => void
}

function folderLabel(folder: string): string {
  return folder === '' ? 'the repository root' : folder
}

function defaultMessage(count: number, folder: string): string {
  return `chore: add ${count} file${count === 1 ? '' : 's'} to ${folderLabel(folder)}`
}

export default function UploadDialog({
  files: initialFiles,
  tree,
  documentPath,
  busy,
  error,
  onUpload,
  onClose,
}: Props) {
  const [files, setFiles] = useState(initialFiles)
  const [folder, setFolder] = useState(() => folderOf(documentPath))
  /** Null until the user edits it, so the suggestion follows the file list. */
  const [typedMessage, setTypedMessage] = useState<string | null>(null)
  const pickerRef = useRef<HTMLInputElement>(null)

  const normalized = normalizeFolder(folder)
  const folderValid = isValidFolder(folder)

  const existing = useMemo(() => new Set(filePaths(tree)), [tree])
  const folders = useMemo(() => directoryPaths(tree), [tree])
  const items = useMemo(
    () => buildItems(files, normalized, existing),
    [files, normalized, existing],
  )

  const message = typedMessage ?? defaultMessage(items.length, normalized)
  const oversize = items.filter((item) => item.size > MAX_UPLOAD_BYTES)
  const preview = items
    .map((item) => markdownForUpload(documentPath, item.path))
    .join('\n\n')
  const ready = items.length > 0 && folderValid && oversize.length === 0 && message.trim() !== ''

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, position) => position !== index))
  }

  const submit = () => {
    if (busy || !ready) return
    onUpload(items, message.trim())
  }

  return (
    <Modal
      title="Upload files"
      description={`${documentPath} · relative paths`}
      onClose={busy ? () => undefined : onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !ready}>
            {busy ? 'Uploading…' : `Upload ${items.length} file${items.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <div className="field">
        <span>Files</span>
        <ul className="upload-list">
          {items.map((item, index) => (
            <li key={`${item.path}-${index}`} className="upload-row">
              <span className="upload-name" title={item.path}>
                {item.name}
              </span>
              <span className="upload-meta">
                {formatSize(item.size)} · {isImageName(item.name) ? 'embed' : 'link'}
              </span>
              <button
                className="upload-remove"
                aria-label={`Remove ${item.name}`}
                title="Remove"
                disabled={busy}
                onClick={() => removeFile(index)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        {items.length === 0 ? <p className="dialog-note">Pick at least one file.</p> : null}
        <div>
          <button className="link-btn" disabled={busy} onClick={() => pickerRef.current?.click()}>
            Add more files
          </button>
        </div>
      </div>

      <label className="field">
        <span>Destination folder</span>
        <input
          className="input"
          value={folder}
          spellCheck={false}
          autoComplete="off"
          placeholder="assets/images"
          data-autofocus
          onChange={(event) => setFolder(event.target.value)}
        />
      </label>

      {folderValid ? (
        <div className="upload-folders" role="group" aria-label="Existing folders">
          <button
            className="upload-folder"
            aria-pressed={normalized === ''}
            onClick={() => setFolder('')}
          >
            / <span>repository root</span>
          </button>
          {folders.map((path) => (
            <button
              key={path}
              className="upload-folder"
              aria-pressed={normalized === path}
              onClick={() => setFolder(path)}
            >
              / <span>{path}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="dialog-error">A folder cannot contain “..”.</p>
      )}

      <p className="dialog-note">
        Type a path that does not exist yet, such as <code>assets/2026</code>, to create it with this
        upload. Files are committed straight to the branch.
      </p>

      <label className="field">
        <span>Commit message</span>
        <input
          className="input"
          value={message}
          spellCheck={false}
          onChange={(event) => {
            setTypedMessage(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
      </label>

      <div className="field">
        <span>Inserted at the cursor</span>
        <pre className="upload-preview">{preview || '—'}</pre>
      </div>

      <input
        ref={pickerRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (picked.length > 0) setFiles((current) => [...current, ...picked])
        }}
      />

      {oversize.length > 0 ? (
        <p className="dialog-error">
          {oversize.map((item) => item.name).join(', ')}{' '}
          {oversize.length === 1 ? 'is' : 'are'} larger than {formatSize(MAX_UPLOAD_BYTES)}.
        </p>
      ) : null}
      {error ? <p className="dialog-error">{error}</p> : null}
    </Modal>
  )
}
