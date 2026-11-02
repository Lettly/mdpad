import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  normalizeProxy,
  readOAuthSettings,
  startDeviceFlow,
  validProxy,
  waitForToken,
  writeOAuthSettings,
  type DeviceCode,
} from '../lib/oauth'

type Props = {
  onConnect: (token: string) => void
  error: string | null
  busy: boolean
}

export default function TokenGate({ onConnect, error, busy }: Props) {
  const [settings, setSettings] = useState(readOAuthSettings)
  const [token, setToken] = useState('')
  const [device, setDevice] = useState<DeviceCode | null>(null)
  const [flowError, setFlowError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [throttledFor, setThrottledFor] = useState<number | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(() => !settings.clientId || !settings.proxy)
  const [clientIdDraft, setClientIdDraft] = useState(settings.clientId)
  const [proxyDraft, setProxyDraft] = useState(settings.proxy)
  const [savedNote, setSavedNote] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const configured = Boolean(settings.clientId && settings.proxy)

  const draftClientId = clientIdDraft.trim()
  const draftProxy = normalizeProxy(proxyDraft)
  const draftValid = Boolean(draftClientId) && validProxy(draftProxy)
  const dirty = draftClientId !== settings.clientId || draftProxy !== settings.proxy

  useEffect(() => () => abortRef.current?.abort(), [])

  /**
   * Writes a usable pair from the advanced fields, so signing in never runs
   * against settings the visitor can see but has not confirmed. Returns whether
   * anything was stored.
   */
  const persistDrafts = () => {
    if (!draftValid || !dirty) return false

    setSettings(writeOAuthSettings({ clientId: draftClientId, proxy: draftProxy }))
    setClientIdDraft(draftClientId)
    setProxyDraft(draftProxy)
    return true
  }

  const begin = async () => {
    persistDrafts()
    setStarting(true)
    setFlowError(null)
    setThrottledFor(null)
    try {
      const code = await startDeviceFlow()
      setDevice(code)

      const controller = new AbortController()
      abortRef.current = controller

      const accessToken = await waitForToken(
        code.device_code,
        code.interval,
        controller.signal,
        setThrottledFor,
      )
      onConnect(accessToken)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setFlowError(cause instanceof Error ? cause.message : String(cause))
      setDevice(null)
    } finally {
      setStarting(false)
      setThrottledFor(null)
    }
  }

  const cancel = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setDevice(null)
    setThrottledFor(null)
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

  const saveAdvanced = (event: FormEvent) => {
    event.preventDefault()
    if (!persistDrafts()) return

    // A code already on screen belongs to the previous app; start over.
    cancel()
    setFlowError(null)
    setSavedNote(true)
    window.setTimeout(() => setSavedNote(false), 2000)
  }

  const useDefaults = () => {
    cancel()
    const next = writeOAuthSettings(null)
    setSettings(next)
    setClientIdDraft(next.clientId)
    setProxyDraft(next.proxy)
    setFlowError(null)
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

        {configured ? (
          <div className="gate-oauth">
            {device ? (
              <div className="device-card">
                <ol className="device-steps">
                  <li>
                    <p className="device-step-text">Open the GitHub page in a new tab.</p>
                    <a
                      className="btn btn-block"
                      href={device.verification_uri}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open GitHub
                    </a>
                  </li>
                  <li>
                    <p className="device-step-text">Enter this code, then approve mdpad.</p>
                    <div className="device-code">{device.user_code}</div>
                    <button className="btn btn-block" onClick={copyCode}>
                      {copied ? 'Copied' : 'Copy code'}
                    </button>
                  </li>
                  <li>
                    <p className="device-step-text">Come back to this tab.</p>
                    <p className="device-wait">
                      <span className="spinner" />{' '}
                      {throttledFor === null
                        ? 'Waiting for authorization…'
                        : `GitHub is limiting sign-ins — retrying in ${throttledFor}s…`}
                    </p>
                  </li>
                </ol>
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

        {configured ? (
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

        <details
          className="gate-advanced"
          open={advancedOpen}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        >
          <summary>
            Advanced — use your own OAuth app
            {settings.custom ? <span className="gate-tag">yours</span> : null}
          </summary>

          <form className="gate-advanced-body" onSubmit={saveAdvanced}>
            <p className="gate-advanced-lead">
              Sign-in with GitHub goes through a small relay, because GitHub&apos;s OAuth endpoints
              send no CORS headers. Point both fields at your own{' '}
              <a href="https://github.com/settings/developers" target="_blank" rel="noreferrer">
                OAuth app
              </a>{' '}
              and{' '}
              <a
                href="https://github.com/Lettly/mdpad/tree/main/oauth-proxy"
                target="_blank"
                rel="noreferrer"
              >
                relay
              </a>{' '}
              to use your own.
            </p>

            <label className="field">
              <span>OAuth App client ID</span>
              <input
                className="input"
                value={clientIdDraft}
                spellCheck={false}
                autoComplete="off"
                placeholder="Ov23li…"
                onChange={(event) => setClientIdDraft(event.target.value)}
              />
            </label>

            <label className="field">
              <span>OAuth relay URL</span>
              <input
                className="input"
                value={proxyDraft}
                spellCheck={false}
                autoComplete="off"
                placeholder="https://mdpad-oauth.<account>.workers.dev"
                onChange={(event) => setProxyDraft(event.target.value)}
              />
            </label>

            {draftClientId && !validProxy(draftProxy) ? (
              <p className="gate-note gate-note-bad">
                The relay needs an absolute URL — <code>https://…</code>, or <code>http://localhost</code>{' '}
                for a relay on this machine.
              </p>
            ) : (
              <p className="gate-note">
                Saved in this browser only. Both values are public; neither is a secret.
              </p>
            )}

            <div className="gate-advanced-actions">
              <button className="btn" type="submit" disabled={!draftValid || !dirty}>
                {savedNote ? 'Saved' : 'Save'}
              </button>
              {settings.defaults.clientId && settings.defaults.proxy ? (
                <button
                  className="btn btn-quiet"
                  type="button"
                  onClick={useDefaults}
                  disabled={!settings.custom}
                >
                  Use the built-in app
                </button>
              ) : null}
            </div>
          </form>
        </details>
      </div>
    </div>
  )
}
