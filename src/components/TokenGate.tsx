import { useState } from 'react'

type Props = {
  onConnect: (token: string) => void
  error: string | null
  busy: boolean
}

export default function TokenGate({ onConnect, error, busy }: Props) {
  const [token, setToken] = useState('')

  return (
    <div className="gate">
      <div className="gate-inner">
        <div className="gate-brand">
          <span className="brand-mark">M</span>
          <span className="brand-name">mdpad</span>
        </div>

        <h1>Write Markdown, commit to GitHub.</h1>
        <p className="gate-lead">
          A WYSIWYG editor for any repository you can push to. The browser talks straight to
          GitHub&apos;s API — there is no server, no database, nothing to trust but this page.
        </p>

        <form
          className="gate-form"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmed = token.trim()
            if (trimmed) onConnect(trimmed)
          }}
        >
          <label className="field">
            <span>Personal access token</span>
            <input
              className="input"
              type="password"
              value={token}
              autoComplete="off"
              spellCheck={false}
              placeholder="github_pat_… or ghp_…"
              onChange={(event) => setToken(event.target.value)}
              data-autofocus
            />
          </label>
          <button className="btn btn-primary btn-block" type="submit" disabled={!token.trim() || busy}>
            {busy ? 'Checking…' : 'Connect'}
          </button>
        </form>

        {error ? <p className="gate-error">{error}</p> : null}

        <ol className="gate-steps">
          <li>
            <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
              Create a fine-grained token
            </a>{' '}
            — pick the repository, then set <em>Contents</em> to <strong>Read and write</strong>.
          </li>
          <li>Paste it above. A classic token with the <code>repo</code> scope works too.</li>
          <li>
            The token stays in this browser&apos;s local storage. Sign out any time from the header.
          </li>
        </ol>
      </div>
    </div>
  )
}
