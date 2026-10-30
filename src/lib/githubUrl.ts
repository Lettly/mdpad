/**
 * Accepts anything a person is likely to paste:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/main/docs
 *   https://github.com/owner/repo/blob/main/docs/guide.md
 *   https://raw.githubusercontent.com/owner/repo/main/docs/guide.md
 *   owner/repo
 *   owner/repo/blob/main/docs/guide.md
 */

export type RepoLink = {
  owner: string
  repo: string
  branch?: string
  path?: string
  kind: 'repo' | 'file'
}

const GITHUB_HOSTS = new Set(['github.com', 'raw.githubusercontent.com'])

export function parseRepoLink(input: string): RepoLink | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  let rest = trimmed.replace(/^git@github\.com:/i, '')

  if (/^https?:\/\//i.test(rest)) {
    let url: URL
    try {
      url = new URL(rest)
    } catch {
      return null
    }
    const host = url.hostname.replace(/^www\./i, '').toLowerCase()
    if (!GITHUB_HOSTS.has(host)) return null
    rest = url.pathname
  } else if (rest.includes('github.com/')) {
    rest = rest.slice(rest.indexOf('github.com/') + 'github.com/'.length)
  }

  const segments = rest
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })

  if (segments.length < 2) return null

  const owner = segments[0]
  const repo = segments[1].replace(/\.git$/i, '')
  if (!owner || !repo) return null

  const view = segments[2]
  if (!view) return { owner, repo, kind: 'repo' }

  // blob/tree/raw/edit/blame all share the same shape: <view>/<branch>/<path>
  if (['blob', 'tree', 'raw', 'edit', 'blame'].includes(view)) {
    const branch = segments[3]
    const path = segments.slice(4).join('/')
    if (!branch) return { owner, repo, kind: 'repo' }
    if (view === 'tree' && !path) return { owner, repo, branch, kind: 'repo' }
    return {
      owner,
      repo,
      branch,
      path: path || undefined,
      kind: view === 'tree' ? 'repo' : 'file',
    }
  }

  // Anything else (issues, pulls, settings...) still points at the repository.
  return { owner, repo, kind: 'repo' }
}
