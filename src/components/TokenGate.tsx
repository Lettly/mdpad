import { useEffect, useRef, useState } from 'react'
import { oauthConfigured, startDeviceFlow, waitForToken, type DeviceCode } from '../lib/oauth'

type Props = {
  onConnect: (token: string) => void
  error: string | null
  busy: boolean
}

export default function TokenGate({ onConnect, error, busy }: Props) {
  const [token, setToken] = useState('')
  const [device, setDevice] = useState<DeviceCode | null>(null)
  const [flowError, setFlowError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const begin = async () => {
    setStarting(true)
    setFlowError(null)
    try {
      const code = await startDeviceFlow()
      setDevice(code)

      const controller = new AbortController()
      abortRef.current = controller

      const accessToken = await waitForToken(code.device_code, code.interval, controller.signal)
      onConnect(accessToken)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setFlowError(cause instanceof Error ? cause.message : String(cause))
      setDevice(null)
    } finally {
      setStarting(false)
    }
  }

  const cancel = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setDevice(null)
  }

  const copyCode = async () => {
    if (!device) return
    try {
      await navigator.clipboard.writeText(device.user_code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be denied; the code is on screen anyway.
    }
  }

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

        {oauthConfigured ? (
          <div className="gate-oauth">
            {device ? (
              <div className="device-card">
                <p className="device-lead">Enter this code on GitHub to authorize mdpad:</p>
                <div className="device-code">{device.user_code}</div>
                <div className="device-actions">
                  <a className="btn" href={device.verification_uri} target="_blank" rel="noreferrer">
                    Open GitHub
                  </a>
                  <button className="btn" onClick={copyCode}>
                    {copied ? 'Copied' : 'Copy code'}
                  </button>
                </div>
                <p className="device-wait">
                  <span className="spinner" /> Waiting for authorization…
                </p>
                <button className="link-btn" onClick={cancel}>
                  Cancel
                </button>
              </div>
            ) : (
              <button className="btn btn-primary btn-block" onClick={begin} disabled={starting || busy}>
                {starting ? 'Contacting GitHub…' : 'Sign in with GitHub'}
              </button>
            )}

            {flowError ? <p className="gate-error">{flowError}</p> : null}
          </div>
        ) : null}

        {oauthConfigured ? (
          <div className="gate-divider">
            <span>or paste a token</span>
          </div>
        ) : null}

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
