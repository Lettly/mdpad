import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CommitDialog from './components/CommitDialog'
import FileTree from './components/FileTree'
import MarkraEditor, { type EditorApi, type EditorMode } from './components/MarkraEditor'
import OpenRepoDialog from './components/OpenRepoDialog'
import TokenGate from './components/TokenGate'
import UploadDialog from './components/UploadDialog'
import {
  branchExists,
  commitFiles,
  describeError,
  getAccount,
  getRepo,
  getTree,
  listBranches,
  readFile,
  writeFile,
  type Account,
  type Repo,
} from './lib/github'
import { parseRepoLink } from './lib/githubUrl'
import { buildTree, filePaths, findNode, isEditable, type TreeNode } from './lib/tree'
import {
  githubBlobUrl,
  isMarkdownPath,
  resolveDocumentLink,
} from './lib/documentLinks'
import { resolveRepoPath } from './lib/images'
import { readRoute, routeToHash, type Route } from './lib/route'
import { loadTheme, loadToken, saveTheme, saveToken, type Theme } from './lib/storage'
import { markdownForUpload, folderOf, type UploadItem } from './lib/upload'

type Session = {
  repo: Repo
  branch: string
  branches: string[]
  tree: TreeNode[]
  truncated: boolean
}

type Doc = { path: string; text: string; sha: string }

export default function App() {
  const [token, setToken] = useState<string | null>(() => loadToken())
  const [account, setAccount] = useState<Account | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  // A stored token has not been verified yet on the first render, so the gate
  // must not be shown until that check settles.
  const [checking, setChecking] = useState(() => loadToken() !== null)

  const [route, setRoute] = useState<Route | null>(() => readRoute())
  const [session, setSession] = useState<Session | null>(null)
  const [repoLoading, setRepoLoading] = useState(false)
  const [repoError, setRepoError] = useState<string | null>(null)
  const [repoReload, setRepoReload] = useState(0)

  const [doc, setDoc] = useState<Doc | null>(null)
  const [text, setText] = useState('')
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [fileReload, setFileReload] = useState(0)

  const [mode, setMode] = useState<EditorMode>('wysiwyg')
  const [theme, setTheme] = useState<Theme>(
    () =>
      loadTheme() ??
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  )

  const [openRepoOpen, setOpenRepoOpen] = useState(false)
  const [commitOpen, setCommitOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)

  const sessionRef = useRef<Session | null>(null)
  const editorApi = useRef<EditorApi | null>(null)
  const pendingValue = useRef<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const uploadPicker = useRef<HTMLInputElement>(null)

  const applySession = useCallback((next: Session | null) => {
    sessionRef.current = next
    setSession(next)
  }, [])

  const showToast = useCallback((message: string, tone: 'ok' | 'error' = 'ok') => {
    setToast({ text: message, tone })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), tone === 'error' ? 6000 : 3200)
  }, [])

  const dirty = doc !== null && text.trimEnd() !== doc.text.trimEnd()
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  /* ---------------------------------------------------------------- theme */

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    saveTheme(theme)
  }, [theme])

  /* ----------------------------------------------------------------- auth */

  useEffect(() => {
    if (!token || account) return
    let cancelled = false
    setChecking(true)
    getAccount(token)
      .then((value) => {
        if (cancelled) return
        setAccount(value)
        setAuthError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setAuthError(describeError(error))
        saveToken(null)
        setToken(null)
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, account])

  const connect = async (candidate: string) => {
    setChecking(true)
    setAuthError(null)
    try {
      const value = await getAccount(candidate)
      saveToken(candidate)
      setAccount(value)
      setToken(candidate)
    } catch (error) {
      setAuthError(describeError(error))
    } finally {
      setChecking(false)
    }
  }

  const signOut = () => {
    if (dirtyRef.current && !window.confirm('You have unsaved changes. Sign out anyway?')) return
    saveToken(null)
    setToken(null)
    setAccount(null)
    applySession(null)
    setDoc(null)
    setMenuOpen(false)
  }

  /* ------------------------------------------------------------- routing */

  useEffect(() => {
    const onHashChange = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = useCallback((next: Route): boolean => {
    if (dirtyRef.current && !window.confirm('You have unsaved changes. Discard them?')) {
      return false
    }
    const hash = routeToHash(next)
    if (window.location.hash === hash) setRoute(next)
    else window.location.hash = hash
    return true
  }, [])

  /** The folder a route points at, so a directory is never read as a file. */
  const folder = useMemo<TreeNode | null>(() => {
    if (!session) return null
    if (!route?.path) {
      return { name: session.repo.full_name, path: '', type: 'dir', children: session.tree }
    }
    const node = findNode(session.tree, route.path)
    return node?.type === 'dir' ? node : null
  }, [session, route?.path])

  const isFolder = folder !== null

  const documentPaths = useMemo(
    () => new Set(session ? filePaths(session.tree) : []),
    [session],
  )

  /**
   * Links in a document are repository paths, not app URLs. A Markdown file
   * opens here, any other file opens on GitHub, and a real URL opens in a tab.
   */
  const openDocumentLink = useCallback(
    (href: string) => {
      const current = sessionRef.current
      const target = resolveDocumentLink(
        href,
        doc?.path ?? null,
        documentPaths,
        resolveRepoPath,
      )
      if (!target) return

      if (target.kind === 'url') {
        window.open(target.url, '_blank', 'noopener,noreferrer')
        return
      }
      if (!current) return

      if (target.kind === 'missing') {
        // A truncated listing cannot prove a file is gone; GitHub can.
        if (current.truncated) {
          window.open(
            githubBlobUrl(
              current.repo.owner.login,
              current.repo.name,
              current.branch,
              target.href.replace(/^\/+/, ''),
            ),
            '_blank',
            'noopener,noreferrer',
          )
          return
        }
        showToast(`No file in this repository matches ${target.href}`, 'error')
        return
      }

      if (target.kind === 'file') {
        if (target.path === doc?.path) return
        navigate({
          owner: current.repo.owner.login,
          repo: current.repo.name,
          branch: current.branch,
          path: target.path,
        })
        return
      }

      window.open(
        githubBlobUrl(
          current.repo.owner.login,
          current.repo.name,
          current.branch,
          target.path,
        ),
        '_blank',
        'noopener,noreferrer',
      )
    },
    [doc?.path, documentPaths, navigate, showToast],
  )

// Several articles in tabs are indistinguishable when every tab says "mdpad".
  useEffect(() => {
    const name = doc?.path.split('/').pop() ?? folder?.name ?? null
    document.title = name ? `${name} · mdpad` : 'mdpad'
  }, [doc?.path, folder?.name])

  // A repository root is a landing page on GitHub, not an empty editor: open
  // the README rather than asking people to find it in the sidebar.
  useEffect(() => {
    if (!session || !route || route.path || repoLoading) return
    const readme = session.tree.find(
      (node) => node.type === 'file' && /^readme\.md$/i.test(node.name),
    )
    if (!readme) return

    const next: Route = { ...route, path: readme.path }
    window.history.replaceState(null, '', routeToHash(next))
    setRoute(next)
  }, [session, route, repoLoading])

  /* ---------------------------------------------------------------- repo */

  useEffect(() => {
    if (!token || !route) {
      applySession(null)
      return
    }

    const current = sessionRef.current
    if (
      current &&
      current.repo.full_name === `${route.owner}/${route.repo}` &&
      (!route.branch || route.branch === current.branch)
    ) {
      return
    }

    let cancelled = false
    setRepoLoading(true)
    setRepoError(null)

    void (async () => {
      try {
        const repo = await getRepo(token, route.owner, route.repo)
        const wanted = route.branch ?? repo.default_branch
        const branch = await resolveBranch(token, repo.owner.login, repo.name, wanted, route.path)
        const [listing, branches] = await Promise.all([
          getTree(token, repo.owner.login, repo.name, branch),
          listBranches(token, repo.owner.login, repo.name),
        ])
        if (cancelled) return
        applySession({
          repo,
          branch,
          branches,
          tree: buildTree(listing.entries),
          truncated: listing.truncated,
        })
      } catch (error) {
        if (cancelled) return
        applySession(null)
        setRepoError(describeError(error))
      } finally {
        if (!cancelled) setRepoLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [token, route, repoReload, applySession])

  /* ---------------------------------------------------------------- file */

  // The document is identified by where it lives, not by the session object:
  // refreshing the tree after an upload replaces the session, and that must not
  // reload the file over the text the user has not saved yet.
  const repoOwner = session?.repo.owner.login ?? null
  const repoName = session?.repo.name ?? null
  const branch = session?.branch ?? null

  useEffect(() => {
    if (!token || !repoOwner || !repoName || !branch || !route?.path) {
      setDoc(null)
      setText('')
      setFileError(null)
      return
    }

    // A folder is shown as a listing, not read as a file.
    if (isFolder) {
      setDoc(null)
      setText('')
      setFileError(null)
      return
    }

    const path = route.path
    if (!isEditable(path)) {
      setDoc(null)
      setText('')
      setFileError('This file is not Markdown or plain text, so it cannot be edited here.')
      return
    }

    let cancelled = false
    setFileLoading(true)
    setFileError(null)

    readFile(token, repoOwner, repoName, path, branch)
      .then((file) => {
        if (cancelled) return

        setDoc({ path, text: file.text, sha: file.sha })
        setText(file.text)
        pendingValue.current = file.text
        editorApi.current?.setValue(file.text)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setDoc(null)
        setText('')
        setFileError(describeError(error))
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [token, repoOwner, repoName, branch, route?.path, fileReload, isFolder])

  /* -------------------------------------------------------------- editor */

  const handleReady = useCallback((api: EditorApi | null) => {
    editorApi.current = api
    // StrictMode mounts the editor twice in development, and the second mount
    // must show the document that was already loaded.
    if (api && pendingValue.current !== null) api.setValue(pendingValue.current)
  }, [])

  const handleSync = useCallback((markdown: string) => {
    setText(markdown)
    // Adopt the editor's own serialisation as the baseline only when nothing is
    // unsaved, so a WYSIWYG/Markdown switch cannot silently drop the dirty flag.
    if (!dirtyRef.current) {
      setDoc((current) => (current ? { ...current, text: markdown } : current))
    }
  }, [])

  /* ----------------------------------------------------------- shortcuts */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (doc && dirtyRef.current) setCommitOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [doc])

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  /* ------------------------------------------------------------- actions */

  const openRepo = (owner: string, repo: string, branch?: string, path?: string) => {
    setOpenRepoOpen(false)
    setFilesOpen(false)
    navigate({ owner, repo, branch, path })
  }

  const openFile = (path: string) => {
    const current = sessionRef.current
    setFilesOpen(false)
    if (!current || path === route?.path) return
    navigate({
      owner: current.repo.owner.login,
      repo: current.repo.name,
      branch: current.branch,
      path,
    })
  }

  const switchBranch = (branch: string) => {
    const current = sessionRef.current
    if (!current || branch === current.branch) return
    navigate({ owner: current.repo.owner.login, repo: current.repo.name, branch })
  }

  const reloadFile = () => {
    if (dirtyRef.current && !window.confirm('Reload from GitHub and lose your changes?')) return
    setFileReload((value) => value + 1)
  }

  /** Uploads land in a new commit, so the sidebar has to be told about them. */
  const refreshTree = useCallback(async () => {
    const current = sessionRef.current
    if (!token || !current) return
    try {
      const listing = await getTree(
        token,
        current.repo.owner.login,
        current.repo.name,
        current.branch,
      )
      const latest = sessionRef.current
      if (
        !latest ||
        latest.branch !== current.branch ||
        latest.repo.full_name !== current.repo.full_name
      ) {
        return
      }
      applySession({ ...latest, tree: buildTree(listing.entries), truncated: listing.truncated })
    } catch {
      // The tree is a convenience; the files themselves are already committed.
    }
  }, [token, applySession])

  const openUpload = (files: File[]) => {
    if (!doc || files.length === 0) return
    setUploadFiles(files)
    setUploadError(null)
    setUploadOpen(true)
  }

  const closeUpload = () => {
    setUploadOpen(false)
    setUploadFiles([])
    setUploadError(null)
  }

  const upload = async (items: UploadItem[], message: string) => {
    const current = sessionRef.current
    const documentPath = doc?.path
    if (!token || !current || !documentPath) return

    setUploading(true)
    setUploadError(null)
    try {
      const files = await Promise.all(
        items.map(async (item) => ({
          path: item.path,
          bytes: new Uint8Array(await item.file.arrayBuffer()),
        })),
      )
      const result = await commitFiles(token, current.repo.owner.login, current.repo.name, {
        branch: current.branch,
        message,
        files,
      })

      const markdown = items.map((item) => markdownForUpload(documentPath, item.path)).join('\n\n')
      editorApi.current?.insertText(`\n\n${markdown}\n\n`)

      closeUpload()
      const folder = folderOf(items[0]?.path ?? '')
      showToast(
        `Uploaded ${items.length} file${items.length === 1 ? '' : 's'} to ${
          folder || 'the repository root'
        } · ${result.commitSha.slice(0, 7)}`,
      )
      void refreshTree()
    } catch (error) {
      setUploadError(describeError(error))
    } finally {
      setUploading(false)
    }
  }

  const requestMode = (next: EditorMode) => {
    if (next === mode) return
    // Hand the Markdown source to the rich editor when coming back from it.
    if (next === 'wysiwyg') editorApi.current?.setValue(text)
    setMode(next)
  }

  const commit = async (message: string) => {
    const current = sessionRef.current
    if (!token || !current || !doc) return
    setSaving(true)
    setCommitError(null)
    try {
      const result = await writeFile(token, current.repo.owner.login, current.repo.name, {
        path: doc.path,
        branch: current.branch,
        text,
        message,
        sha: doc.sha,
      })
      setDoc({ path: doc.path, text, sha: result.contentSha })
      setCommitOpen(false)
      showToast(`Pushed to ${current.branch} · ${result.commitSha.slice(0, 7)}`)
    } catch (error) {
      setCommitError(describeError(error))
    } finally {
      setSaving(false)
    }
  }

  const home = () => {
    if (dirtyRef.current && !window.confirm('You have unsaved changes. Discard them?')) return
    window.location.hash = ''
    setRoute(null)
    applySession(null)
    setDoc(null)
  }

  const crumbs = useMemo(() => (route?.path ? route.path.split('/') : []), [route?.path])

  /* ---------------------------------------------------------------- views */

  // A token in storage is validated before anything else is shown; rendering
  // the gate while that check runs would flash the login screen on every
  // reload of an already signed-in session.
  if (token && !account && !authError) {
    return <SessionSplash />
  }

  if (!token || !account) {
    return <TokenGate onConnect={connect} error={authError} busy={checking} />
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <button className="brand" onClick={home} title="Home">
            <span className="brand-mark">M</span>
            <span className="brand-name">mdpad</span>
          </button>

          {session ? (
            <button
              className="btn btn-quiet files-toggle"
              aria-expanded={filesOpen}
              onClick={() => setFilesOpen((open) => !open)}
            >
              Files
            </button>
          ) : null}

          {session ? (
            <>
              <span className="slash">/</span>
              <button
                className="repo-chip"
                onClick={() => setOpenRepoOpen(true)}
                title="Open another repository"
              >
                {session.repo.full_name}
                {session.repo.private ? <span className="pill">private</span> : null}
              </button>
              <select
                className="branch-select"
                value={session.branch}
                onChange={(event) => switchBranch(event.target.value)}
                title="Branch"
              >
                {session.branches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            </>
          ) : null}
        </div>

        <div className="topbar-right">
          {doc ? (
            <>
              <span className={dirty ? 'status is-dirty' : 'status'}>
                <span className="status-dot" />
                {dirty ? 'Unsaved' : 'Saved'}
              </span>
              <button
                className="btn btn-primary"
                onClick={() => setCommitOpen(true)}
                disabled={!dirty}
                title="Commit and push (⌘S)"
              >
                Save
              </button>
            </>
          ) : null}

          <button
            className="icon-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title="Toggle theme"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>

          <div className="menu-wrap">
            <button
              className="avatar"
              onClick={() => setMenuOpen((value) => !value)}
              title={`Signed in as ${account.login}`}
            >
              {account.login.slice(0, 1).toUpperCase()}
            </button>
            {menuOpen ? (
              <>
                <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="menu">
                  <p className="menu-title">{account.login}</p>
                  <button className="menu-item" onClick={signOut}>
                    Sign out
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <div className={filesOpen ? 'workspace sidebar-open' : 'workspace'}>
        {session ? (
          <FileTree
            key={`${session.repo.full_name}@${session.branch}`}
            tree={session.tree}
            selectedPath={route?.path ?? null}
            onOpen={openFile}
            truncated={session.truncated}
          />
        ) : null}
        <button
          className="sidebar-scrim"
          aria-label="Close files"
          onClick={() => setFilesOpen(false)}
        />

        <main className="main">
          {!route ? (
            <Home account={account.login} onOpen={openRepo} onBrowse={() => setOpenRepoOpen(true)} />
          ) : (
            <>
              <div className="pane-head">
                <div className="crumbs">
                  {crumbs.length > 0 ? (
                    crumbs.map((part, index) => (
                      <span key={`${part}-${index}`} className="crumb">
                        {part}
                        {index < crumbs.length - 1 ? <span className="crumb-sep">/</span> : null}
                      </span>
                    ))
                  ) : (
                    <span className="crumb">{route.owner}/{route.repo}</span>
                  )}
                </div>

                <div className="pane-actions">
                  {doc ? (
                    <>
                      <button
                        className="btn btn-quiet"
                        onClick={() => uploadPicker.current?.click()}
                        title="Upload files into this repository"
                      >
                        Upload
                      </button>
                      <button className="link-btn" onClick={reloadFile} title="Reload from GitHub">
                        Reload
                      </button>
                    </>
                  ) : null}
                  {doc ? (
                    <div className="segmented" role="group" aria-label="Editor mode">
                      <button
                        aria-pressed={mode === 'wysiwyg'}
                        onClick={() => requestMode('wysiwyg')}
                      >
                        WYSIWYG
                      </button>
                      <button
                        aria-pressed={mode === 'markdown'}
                        onClick={() => requestMode('markdown')}
                      >
                        Markdown
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="pane-body">

                {repoLoading ? <Loading label="Loading repository…" /> : null}

                {!repoLoading && repoError ? (
                  <ErrorPane
                    message={repoError}
                    onRetry={() => {
                      applySession(null)
                      setRepoReload((value) => value + 1)
                    }}
                  />
                ) : null}

                {!repoLoading && !repoError && !route.path && !folder ? (
                  <Placeholder session={session} />
                ) : null}

                {!repoLoading && !repoError && folder ? (
                  <FolderPane
                    node={folder}
                    root={!route.path}
                    onOpen={openFile}
                  />
                ) : null}

                {!repoLoading && !repoError && route.path && fileLoading && !doc ? (
                  <Loading label="Opening file…" />
                ) : null}

                {!repoLoading && !repoError && fileError ? (
                  <ErrorPane message={fileError} onRetry={reloadFile} />
                ) : null}

                {doc && !fileError ? (
                  <div
                    className="editor-shell"
                    onDragOver={(event) => {
                      if (hasFiles(event.dataTransfer)) event.preventDefault()
                    }}
                    onDrop={(event) => {
                      const dropped = filesFrom(event.dataTransfer)
                      if (dropped.length === 0) return
                      event.preventDefault()
                      openUpload(dropped)
                    }}
                    onPasteCapture={(event) => {
                      const pasted = filesFrom(event.clipboardData)
                      if (pasted.length === 0) return
                      event.preventDefault()
                      event.stopPropagation()
                      openUpload(pasted)
                    }}
                  >
                    <MarkraEditor
                      mode={mode}
                      theme={theme}
                      imageLocation={
                        session && doc
                          ? {
                              owner: session.repo.owner.login,
                              repo: session.repo.name,
                              branch: session.branch,
                              documentPath: doc.path,
                              private: session.repo.private,
                              token,
                            }
                          : undefined
                      }
                      value={text}
                      onChange={setText}
                      onSync={handleSync}
                      onOpenLink={openDocumentLink}
                      onReady={handleReady}
                      onUpload={() => uploadPicker.current?.click()}
                    />
                    {fileLoading ? <div className="editor-veil" /> : null}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </main>
      </div>

      {openRepoOpen ? (
        <OpenRepoDialog
          initialValue={session ? `https://github.com/${session.repo.full_name}` : ''}
          onOpen={openRepo}
          onClose={() => setOpenRepoOpen(false)}
        />
      ) : null}

      {commitOpen && doc ? (
        <CommitDialog
          path={doc.path}
          branch={session?.branch ?? 'main'}
          busy={saving}
          error={commitError}
          onCommit={commit}
          onClose={() => {
            setCommitOpen(false)
            setCommitError(null)
          }}
        />
      ) : null}

      {uploadOpen && doc && session ? (
        <UploadDialog
          files={uploadFiles}
          tree={session.tree}
          documentPath={doc.path}
          busy={uploading}
          error={uploadError}
          onUpload={upload}
          onClose={closeUpload}
        />
      ) : null}

      <input
        ref={uploadPicker}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? [])
          event.target.value = ''
          openUpload(picked)
        }}
      />

      {toast ? <div className={`toast ${toast.tone}`}>{toast.text}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ bits */

function filesFrom(transfer: DataTransfer | null): File[] {
  if (!transfer?.files?.length) return []
  return Array.from(transfer.files)
}

function hasFiles(transfer: DataTransfer | null): boolean {
  return Boolean(transfer?.types?.includes('Files'))
}

async function resolveBranch(
  token: string,
  owner: string,
  repo: string,
  wanted: string,
  path: string | undefined,
): Promise<string> {
  if (await branchExists(token, owner, repo, wanted)) return wanted

  // "blob/feature/x/file.md" is ambiguous: the branch itself may contain slashes.
  const segments = (path ?? '').split('/').filter(Boolean)
  for (let i = 1; i <= segments.length; i++) {
    const candidate = [wanted, ...segments.slice(0, i)].join('/')
    if (await branchExists(token, owner, repo, candidate)) return candidate
  }

  throw new Error(`Branch "${wanted}" was not found in ${owner}/${repo}.`)
}

function SessionSplash() {
  return (
    <div className="gate">
      <div className="gate-inner gate-splash">
        <div className="gate-brand">
          <span className="brand-mark">M</span>
          <span className="brand-name">mdpad</span>
        </div>
        <p className="gate-splash-text">
          <span className="spinner" /> Restoring your session…
        </p>
      </div>
    </div>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div className="pane-state">
      <span className="spinner" />
      <p>{label}</p>
    </div>
  )
}

function ErrorPane({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="pane-state">
      <p className="pane-error">{message}</p>
      <button className="btn" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}

function FolderPane({
  node,
  root,
  onOpen,
}: {
  node: TreeNode
  root: boolean
  onOpen: (path: string) => void
}) {
  const folders = node.children.filter((child) => child.type === 'dir')
  const files = node.children.filter((child) => child.type === 'file')
  const markdown = files.filter((file) => isMarkdownPath(file.path))
  const others = files.length - markdown.length
  const articles = countMarkdown(node)

  return (
    <div className="folder-pane">
      <div className="folder-inner">
        <p className="folder-eyebrow">{root ? 'Repository root' : 'Folder'}</p>
        <h1 className="folder-title">{root ? node.name : node.name}</h1>
        <p className="folder-summary">
          {folders.length} folder{folders.length === 1 ? '' : 's'} · {articles} article
          {articles === 1 ? '' : 's'}
          {others > 0 ? ` · ${others} other file${others === 1 ? '' : 's'}` : ''}
        </p>

        <ul className="folder-list">
          {folders.map((child) => (
            <li key={child.path}>
              <button className="folder-row is-folder" onClick={() => onOpen(child.path)}>
                <span className="folder-row-name">{child.name}</span>
                <span className="folder-row-meta">{countMarkdown(child)}</span>
              </button>
            </li>
          ))}
          {markdown.map((file) => (
            <li key={file.path}>
              <button className="folder-row" onClick={() => onOpen(file.path)}>
                <span className="folder-row-name">{file.name.replace(/\.md$/i, '')}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function countMarkdown(node: TreeNode): number {
  return node.children.reduce(
    (total, child) =>
      total +
      (child.type === 'file' ? (isMarkdownPath(child.path) ? 1 : 0) : countMarkdown(child)),
    0,
  )
}

function Placeholder({ session }: { session: Session | null }) {
  return (
    <div className="pane-state">
      <p className="pane-hint">Pick a Markdown file from the sidebar to start writing.</p>
      {session ? (
        <p className="pane-sub">
          Branch <code>{session.branch}</code>
        </p>
      ) : null}
    </div>
  )
}

function Home({
  account,
  onOpen,
  onBrowse,
}: {
  account: string
  onOpen: (owner: string, repo: string, branch?: string, path?: string) => void
  onBrowse: () => void
}) {
  const [value, setValue] = useState('')
  const parsed = parseRepoLink(value)

  return (
    <div className="home">
      <div className="home-inner">
        <h1>Open a repository.</h1>
        <p className="home-lead">
          Paste a GitHub repository or file URL. Everything is fetched in your browser, and saving
          becomes a commit on the branch you choose.
        </p>

        <form
          className="home-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (parsed) onOpen(parsed.owner, parsed.repo, parsed.branch, parsed.path)
          }}
        >
          <input
            className="input"
            value={value}
            spellCheck={false}
            autoComplete="off"
            placeholder="https://github.com/owner/repo/blob/main/README.md"
            onChange={(event) => setValue(event.target.value)}
            data-autofocus
          />
          <button className="btn btn-primary" type="submit" disabled={!parsed}>
            Open
          </button>
        </form>

        <p className="home-hint">
          {value.trim() === '' ? (
            <>
              Signed in as <strong>{account}</strong>. Paste a link, or{' '}
              <button className="link-btn" onClick={onBrowse}>
                pick a repository
              </button>
              .
            </>
          ) : parsed ? (
            <>
              {parsed.owner}/{parsed.repo}
              {parsed.branch ? ` · ${parsed.branch}` : ''}
              {parsed.path ? ` · ${parsed.path}` : ''}
            </>
          ) : (
            <span className="bad">That does not look like a GitHub URL.</span>
          )}
        </p>
      </div>
    </div>
  )
}
