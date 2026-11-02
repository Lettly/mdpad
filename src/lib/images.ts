/**
 * Markdown images point either at an absolute URL or at a path relative to the
 * document. A relative path has to become something the browser can load: the
 * raw host for a public repository, and an authenticated blob for a private one.
 */

const SAFE_ABSOLUTE = /^(?:https?:|data:|blob:)/i
const SCHEME = /^[a-z][a-z\d+.-]*:/i

export type ImageLocation = {
  owner: string
  repo: string
  branch: string
  /** Path of the document being edited, so `./` and `../` resolve correctly. */
  documentPath: string
  private: boolean
  token: string | null
}

/** `docs/guide.md` + `../assets/logo.png` → `assets/logo.png` */
export function resolveRepoPath(documentPath: string, source: string): string | null {
  const path = source.split(/[?#]/)[0]?.trim() ?? ''
  if (!path) return null

  const segments = path.startsWith('/') ? [] : documentPath.split('/').slice(0, -1)

  for (const raw of path.replace(/^\/+/, '').split('/')) {
    // A Markdown destination is a URL, so `%20` is a space in the file name.
    const segment = decodeSegment(raw)
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }

  return segments.length > 0 ? segments.join('/') : null
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    // A stray `%` is a literal character, not an escape.
    return segment
  }
}

export function rawImageUrl(location: ImageLocation, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `https://raw.githubusercontent.com/${location.owner}/${location.repo}/${encodeURIComponent(
    location.branch,
  )}/${encoded}`
}

const blobs = new Map<string, string>()
const pending = new Set<string>()

const cacheKey = (location: ImageLocation, path: string) =>
  `${location.owner}/${location.repo}/${location.branch}/${path}`

/**
 * Private repositories cannot be read from `raw.githubusercontent.com` with a
 * token, so the bytes come through the contents API and are shown as a blob.
 * The cache is per path and lives for the page session.
 */
async function loadPrivateImage(
  location: ImageLocation,
  path: string,
  onReady: () => void,
): Promise<void> {
  const key = cacheKey(location, path)
  if (pending.has(key) || !location.token) return
  pending.add(key)

  try {
    const encoded = path.split('/').map(encodeURIComponent).join('/')
    const response = await fetch(
      `https://api.github.com/repos/${location.owner}/${location.repo}/contents/${encoded}?ref=${encodeURIComponent(
        location.branch,
      )}`,
      {
        headers: {
          Accept: 'application/vnd.github.raw',
          Authorization: `Bearer ${location.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    )
    if (!response.ok) return

    blobs.set(key, URL.createObjectURL(await response.blob()))
    onReady()
  } catch {
    /* a missing image keeps its alt text */
  } finally {
    pending.delete(key)
  }
}

/**
 * Returns a URL the browser can load, or null when the image cannot be shown
 * yet — the editor then keeps the Markdown source in place.
 */
export function resolveImage(
  location: ImageLocation,
  source: string,
  onReady: () => void,
): string | null {
  const trimmed = source.trim()
  if (!trimmed) return null
  if (SAFE_ABSOLUTE.test(trimmed)) return trimmed
  if (SCHEME.test(trimmed) || trimmed.startsWith('#')) return null

  const path = resolveRepoPath(location.documentPath, trimmed)
  if (!path) return null
  if (!location.private) return rawImageUrl(location, path)

  const cached = blobs.get(cacheKey(location, path))
  if (cached) return cached

  void loadPrivateImage(location, path, onReady)
  return null
}
