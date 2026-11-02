/**
 * Turns a link written in a document into something the app can open.
 *
 * A Markdown file in a repository is read on GitHub, where `/articles/foo`
 * means "the article published at /articles/foo" and `../assets/x.png` means
 * "a file next to this one". Neither is a URL the browser can resolve against
 * the app, so every href is mapped onto the repository tree first: a Markdown
 * file opens in the app, any other file opens on GitHub, and a real URL is left
 * alone.
 */

export type DocumentLinkTarget =
  /** A Markdown file in this repository: open it in the app. */
  | { kind: 'file'; path: string }
  /** A repository file the app cannot edit (image, PDF, …): open it on GitHub. */
  | { kind: 'repo'; path: string }
  /** Anything already addressable: http(s), mailto, tel, protocol-relative. */
  | { kind: 'url'; url: string }
  /** Nothing in the repository matches, so there is nowhere to go. */
  | { kind: 'missing'; href: string }

const EXTERNAL_HREF = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i
const OPENABLE_SCHEME = /^(?:https?:|mailto:|tel:)/i
const MARKDOWN_FILE = /\.(?:md|markdown)$/i
const HAS_EXTENSION = /\.[a-z\d]+$/i

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_FILE.test(path)
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function withoutExtension(path: string): string {
  return path.replace(MARKDOWN_FILE, '')
}

/** `docs/a.md#add-an-article` → `docs/a.md` */
function hrefPath(href: string): string {
  const hash = href.indexOf('#')
  const withoutHash = hash >= 0 ? href.slice(0, hash) : href
  const query = withoutHash.indexOf('?')
  return (query >= 0 ? withoutHash.slice(0, query) : withoutHash).trim()
}

function classify(path: string): DocumentLinkTarget {
  return isMarkdownPath(path) ? { kind: 'file', path } : { kind: 'repo', path }
}

function match(path: string, files: ReadonlySet<string>): DocumentLinkTarget | null {
  return files.has(path) ? classify(path) : null
}

/**
 * A published URL drops the folder and the extension: `articles/account/foo.md`
 * is served at `/articles/foo`. When the literal path misses, the file with that
 * name is the intended target. Duplicates (a `sandbox/` copy, say) are settled
 * by depth first, then by whichever sits closest to the document being read.
 */
function matchBySlug(
  slug: string,
  files: ReadonlySet<string>,
  documentPath: string | null,
): DocumentLinkTarget | null {
  const matches = [...files].filter(
    (path) => isMarkdownPath(path) && baseName(withoutExtension(path)) === slug,
  )
  if (matches.length === 0) return null
  if (matches.length === 1) return { kind: 'file', path: matches[0]! }

  const documentParts = (documentPath ?? '').split('/').slice(0, -1)
  const sharedPrefix = (path: string) => {
    const parts = path.split('/')
    let shared = 0
    while (shared < parts.length && parts[shared] === documentParts[shared]) shared += 1
    return shared
  }

  matches.sort(
    (left, right) =>
      left.split('/').length - right.split('/').length ||
      sharedPrefix(right) - sharedPrefix(left),
  )
  return { kind: 'file', path: matches[0]! }
}

export function resolveDocumentLink(
  href: string,
  documentPath: string | null,
  files: ReadonlySet<string>,
  /** `docs/a.md` + `../assets/x.png` → `assets/x.png` */
  resolvePath: (documentPath: string, source: string) => string | null,
): DocumentLinkTarget | null {
  const trimmed = href.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  if (EXTERNAL_HREF.test(trimmed)) {
    // `javascript:` and friends never reach the browser's address bar.
    if (trimmed.startsWith('//') || OPENABLE_SCHEME.test(trimmed)) {
      return { kind: 'url', url: trimmed }
    }
    return null
  }

  const path = resolvePath(documentPath ?? '', hrefPath(trimmed))
  if (!path) return null

  const exact = match(path, files)
  if (exact) return exact

  if (!HAS_EXTENSION.test(path)) {
    const withExtension = match(`${path}.md`, files)
    if (withExtension) return withExtension

    const folderIndex = match(`${path}/index.md`, files)
    if (folderIndex) return folderIndex

    const bySlug = matchBySlug(baseName(path), files, documentPath)
    if (bySlug) return bySlug
  }

  return { kind: 'missing', href: trimmed }
}

export function githubBlobUrl(
  owner: string,
  repo: string,
  branch: string,
  path: string,
): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${encoded}`
}
