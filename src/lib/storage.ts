const TOKEN_KEY = 'mdpad.token'
const THEME_KEY = 'mdpad.theme'
const OAUTH_KEY = 'mdpad.oauth'

export type Theme = 'light' | 'dark'

/** A visitor's own OAuth app client id and relay URL. */
export type OAuthOverride = { clientId: string; proxy: string }

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function saveToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Private browsing: the token simply won't survive a reload.
  }
}

export function loadTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Ignore.
  }
}

export function loadOAuthOverride(): OAuthOverride | null {
  try {
    const raw = localStorage.getItem(OAUTH_KEY)
    if (!raw) return null

    const value = JSON.parse(raw) as Partial<OAuthOverride>
    if (typeof value.clientId !== 'string' || typeof value.proxy !== 'string') return null
    if (!value.clientId.trim() || !value.proxy.trim()) return null

    return { clientId: value.clientId.trim(), proxy: value.proxy.trim() }
  } catch {
    return null
  }
}

export function saveOAuthOverride(value: OAuthOverride | null): void {
  try {
    if (value) localStorage.setItem(OAUTH_KEY, JSON.stringify(value))
    else localStorage.removeItem(OAUTH_KEY)
  } catch {
    // Ignore.
  }
}
