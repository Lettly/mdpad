import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CommitDialog from './components/CommitDialog'
import FileTree from './components/FileTree'
import MarkdownEditor, { type EditorApi, type EditorMode } from './components/MarkdownEditor'
import OpenRepoDialog from './components/OpenRepoDialog'
import TokenGate from './components/TokenGate'
import {
  branchExists,
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
import { buildTree, isEditable, type TreeNode } from './lib/tree'
import { readRoute, routeToHash, type Route } from './lib/route'
import { loadTheme, loadToken, saveTheme, saveToken, type Theme } from './lib/storage'

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
  const [checking, setChecking] = useState(false)

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
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)

  const sessionRef = useRef<Session | null>(null)
  const editorApi = useRef<EditorApi | null>(null)
  const pendingValue = useRef<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

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

  useEffect(() => {
    if (!token || !session || !route?.path) {
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

    readFile(token, session.repo.owner.login, session.repo.name, path, session.branch)
      .then((file) => {
        if (cancelled) return
        setDoc({ path, text: file.text, sha: file.sha })
        setText(file.text)
        pendingValue.current = file.text
        if (editorApi.current) editorApi.current.setValue(file.text)
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
  }, [token, session, route?.path, fileReload])

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
    navigate({ owner, repo, branch, path })
  }

  const openFile = (path: string) => {
    const current = sessionRef.current
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

      <div className="workspace">
        {session ? (
          <FileTree
            key={`${session.repo.full_name}@${session.branch}`}
            tree={session.tree}
            selectedPath={route?.path ?? null}
            onOpen={openFile}
            truncated={session.truncated}
          />
        ) : null}

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
                    <button className="link-btn" onClick={reloadFile} title="Reload from GitHub">
                      Reload
                    </button>
                  ) : null}
                  <div className="segmented" role="group" aria-label="Editor mode">
                    <button aria-pressed={mode === 'wysiwyg'} onClick={() => setMode('wysiwyg')}>
                      WYSIWYG
                    </button>
                    <button aria-pressed={mode === 'markdown'} onClick={() => setMode('markdown')}>
                      Markdown
                    </button>
                  </div>
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

                {!repoLoading && !repoError && !route.path ? <Placeholder session={session} /> : null}

                {!repoLoading && !repoError && route.path && fileLoading && !doc ? (
                  <Loading label="Opening file…" />
                ) : null}

                {!repoLoading && !repoError && fileError ? (
                  <ErrorPane message={fileError} onRetry={reloadFile} />
                ) : null}

                {doc && !fileError ? (
                  <div className="editor-shell">
                    <MarkdownEditor
                      mode={mode}
                      dark={theme === 'dark'}
                      onChange={setText}
                      onSync={handleSync}
                      onReady={handleReady}
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

      {toast ? <div className={`toast ${toast.tone}`}>{toast.text}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ bits */

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
