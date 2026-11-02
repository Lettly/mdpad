/**
 * GitHub OAuth device flow, relayed through the small worker in `oauth-proxy/`
 * because github.com's OAuth endpoints do not send CORS headers.
 *
 * The build ships a client id and relay URL, and a visitor can point both at
 * their own OAuth app from the login screen's advanced settings.
 */

import { loadOAuthOverride, saveOAuthOverride } from './storage'

/** What the build shipped. Both values are public, so they sit in `.env`. */
const defaults = {
  clientId: import.meta.env.VITE_OAUTH_CLIENT_ID ?? '',
  proxy: normalizeProxy(import.meta.env.VITE_OAUTH_PROXY ?? ''),
}

export type OAuthSettings = {
  clientId: string
  proxy: string
  /** The build's own pair, so the screen can offer a way back. */
  defaults: { clientId: string; proxy: string }
  /** True once the visitor has saved their own pair. */
  custom: boolean
}

export function readOAuthSettings(): OAuthSettings {
  const saved = loadOAuthOverride()
  return {
    clientId: saved?.clientId ?? defaults.clientId,
    proxy: saved?.proxy ?? defaults.proxy,
    defaults,
    custom: saved !== null,
  }
}

/** Passing null drops the override and returns to the build's pair. */
export function writeOAuthSettings(next: { clientId: string; proxy: string } | null): OAuthSettings {
  saveOAuthOverride(
    next ? { clientId: next.clientId.trim(), proxy: normalizeProxy(next.proxy) } : null,
  )
  return readOAuthSettings()
}

export function normalizeProxy(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

/** A relay has to be an absolute URL; plain http only for a relay on this machine. */
export function validProxy(value: string): boolean {
  try {
    const url = new URL(normalizeProxy(value))
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    return url.protocol === 'https:' || (url.protocol === 'http:' && local)
  } catch {
    return false
  }
}

export type DeviceCode = {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

type TokenResponse = {
  access_token?: string
  error?: string
  error_description?: string
  /** Sent with `slow_down`: the interval GitHub wants the client to use next. */
  interval?: number
}

type ErrorBody = {
  error?: string
  error_description?: string
  message?: string
}

/** GitHub's wording when it throttles or blocks the relay's egress address. */
const RESTRICTED = /restricted|rate limit/i

/** What a visitor can do about it: wait, or skip OAuth with a token. */
const THROTTLED =
  'GitHub is limiting sign-ins right now. Wait a minute and try again, or paste a personal access token below.'

/** Longest single backoff, and how many throttled answers in a row we absorb. */
const MAX_BACKOFF = 30
const MAX_THROTTLED = 8

/** A failed relay call, tagged so the poll loop can tell transient from final. */
class RelayError extends Error {
  status: number
  retryAfter: number | null
  transient: boolean

  constructor(status: number, message: string, retryAfter: number | null, transient: boolean) {
    super(message)
    this.name = 'RelayError'
    this.status = status
    this.retryAfter = retryAfter
    this.transient = transient
  }
}

async function post<T>(
  config: OAuthSettings,
  path: string,
  body: Record<string, string>,
): Promise<T> {
  const response = await fetch(`${config.proxy}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })

  let data: unknown
  try {
    data = await response.json()
  } catch {
    if (response.ok) {
      throw new RelayError(
        response.status,
        'The OAuth relay answered with something that is not JSON.',
        null,
        false,
      )
    }
    data = {}
  }

  if (!response.ok) {
    const failure = data as ErrorBody
    const raw =
      failure.error_description ??
      failure.message ??
      failure.error ??
      `The OAuth relay answered ${response.status}.`
    const throttled = response.status === 429 || RESTRICTED.test(raw)

    throw new RelayError(
      response.status,
      throttled ? THROTTLED : raw,
      retryAfterSeconds(response),
      throttled || response.status >= 500,
    )
  }

  return data as T
}

/** `Retry-After` arrives in seconds; the relay exposes it so we can honour it. */
function retryAfterSeconds(response: Response): number | null {
  const header = response.headers.get('retry-after')
  if (!header) return null

  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

export function startDeviceFlow(scope = 'repo'): Promise<DeviceCode> {
  return startWithRetry(readOAuthSettings(), scope)
}

/**
 * Asks for a code, absorbing a short burst of throttling. GitHub blocks the
 * relay's shared egress address now and then, and one 429 should not cost the
 * visitor a click.
 */
async function startWithRetry(config: OAuthSettings, scope: string): Promise<DeviceCode> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await post<DeviceCode>(config, '/device/code', { client_id: config.clientId, scope })
    } catch (cause) {
      if (!(cause instanceof RelayError) || !cause.transient || attempt >= 3) throw cause

      const backoff = Math.min(MAX_BACKOFF, (cause.retryAfter ?? 2) * 2 ** (attempt - 1))
      await sleep(backoff * 1000)
    }
  }
}

/**
 * Polls until the user authorises the app, then resolves with the token.
 *
 * GitHub throttles the relay — Cloudflare's egress addresses are shared, so
 * `/access_token` sometimes answers 429 "access has been restricted" — and asks
 * for a longer interval with `slow_down`. Both are retried here rather than
 * thrown, so a burst of throttling does not throw away the code the user is
 * typing into GitHub.
 */
export async function waitForToken(
  deviceCode: string,
  interval: number,
  signal: AbortSignal,
  onThrottle?: (seconds: number) => void,
): Promise<string> {
  let wait = Math.max(interval, 5)
  let throttled = 0
  // Read once: a code issued to one app must be polled against that same app.
  const config = readOAuthSettings()

  for (;;) {
    await sleep(wait * 1000, signal)

    let data: TokenResponse
    try {
      data = await post<TokenResponse>(config, '/access_token', {
        client_id: config.clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      })
      throttled = 0
    } catch (cause) {
      if (!(cause instanceof RelayError) || !cause.transient) throw cause

      throttled += 1
      if (throttled > MAX_THROTTLED) throw new Error(THROTTLED)

      const backoff = Math.min(MAX_BACKOFF, (cause.retryAfter ?? 5) * 2 ** (throttled - 1))
      onThrottle?.(backoff)
      await sleep(backoff * 1000, signal)
      continue
    }

    if (data.access_token) return data.access_token

    switch (data.error) {
      case 'authorization_pending':
        break
      case 'slow_down':
        // GitHub names the interval it wants next; growing blindly drifts.
        wait = Math.max(wait + 5, data.interval ?? 0)
        break
      case 'expired_token':
        throw new Error('That code expired. Start again to get a fresh one.')
      case 'access_denied':
        throw new Error('Authorization was declined on GitHub.')
      default:
        throw new Error(data.error_description ?? data.error ?? 'Authorization failed.')
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const onAbort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
