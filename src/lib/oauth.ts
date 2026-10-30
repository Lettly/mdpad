/**
 * GitHub OAuth device flow, relayed through the small worker in `oauth-proxy/`
 * because github.com's OAuth endpoints do not send CORS headers.
 */

const proxy = import.meta.env.VITE_OAUTH_PROXY
const clientId = import.meta.env.VITE_OAUTH_CLIENT_ID

export const oauthConfigured = Boolean(proxy && clientId)

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
}

async function post<T>(path: string, body: Record<string, string>): Promise<T> {
  const response = await fetch(`${proxy}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error(`The OAuth relay answered ${response.status} with something that is not JSON.`)
  }

  if (!response.ok) {
    const message = (data as { error_description?: string; error?: string }).error_description
    throw new Error(message ?? `The OAuth relay answered ${response.status}.`)
  }

  return data as T
}

export function startDeviceFlow(scope = 'repo'): Promise<DeviceCode> {
  return post<DeviceCode>('/device/code', { client_id: clientId!, scope })
}

/** Polls until the user authorises the app, then resolves with the token. */
export async function waitForToken(
  deviceCode: string,
  interval: number,
  signal: AbortSignal,
): Promise<string> {
  let wait = Math.max(interval, 5)

  for (;;) {
    await sleep(wait * 1000, signal)

    const data = await post<TokenResponse>('/access_token', {
      client_id: clientId!,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    })

    if (data.access_token) return data.access_token

    switch (data.error) {
      case 'authorization_pending':
        break
      case 'slow_down':
        wait += 5
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

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const onAbort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    signal.addEventListener('abort', onAbort, { once: true })
  })
}
