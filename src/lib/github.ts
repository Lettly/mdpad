/**
 * Minimal GitHub REST client. Every call goes straight from the browser to
 * api.github.com, which sends permissive CORS headers, so no server is needed.
 */

import { decodeBase64, encodeBase64, utf8Length } from './base64'

const API = 'https://api.github.com'

export class GitHubError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
  }
}

export type Account = { login: string; name: string | null; avatar_url: string }

export type Repo = {
  name: string
  full_name: string
  default_branch: string
  private: boolean
  owner: { login: string }
  permissions?: { push?: boolean; admin?: boolean }
}

export type TreeEntry = {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
  size?: number
}

export type RemoteFile = { text: string; sha: string; size: number }

type Call = { method?: string; body?: unknown; token?: string | null }

async function call<T>(path: string, init: Call = {}): Promise<T> {
  const { method = 'GET', body, token } = init

  let response: Response
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new GitHubError(0, 'Could not reach api.github.com. Check your connection.')
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const data = (await response.json()) as { message?: string }
      if (data?.message) message = data.message
    } catch {
      // Non-JSON error body: keep the status line.
    }
    throw new GitHubError(response.status, message)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export function getAccount(token: string): Promise<Account> {
  return call<Account>('/user', { token })
}

export function getRepo(token: string, owner: string, repo: string): Promise<Repo> {
  return call<Repo>(`/repos/${owner}/${repo}`, { token })
}

export async function listBranches(token: string, owner: string, repo: string): Promise<string[]> {
  const names: string[] = []
  for (let page = 1; page <= 5; page++) {
    const batch = await call<{ name: string }[]>(
      `/repos/${owner}/${repo}/branches?per_page=100&page=${page}`,
      { token },
    )
    names.push(...batch.map((branch) => branch.name))
    if (batch.length < 100) break
  }
  return names
}

export async function branchExists(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<boolean> {
  try {
    await call(`/repos/${owner}/${repo}/branches/${encodePath(branch)}`, { token })
    return true
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return false
    throw error
  }
}

/** Flat, recursive listing of every blob in a tree. */
export async function getTree(
  token: string,
  owner: string,
  repo: string,
  ref: string,
): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  const data = await call<{ tree: TreeEntry[]; truncated: boolean }>(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { token },
  )
  return { entries: data.tree, truncated: Boolean(data.truncated) }
}

type ContentsFile = {
  type: string
  sha: string
  size: number
  content?: string
  encoding?: string
}

export async function readFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<RemoteFile> {
  const data = await call<ContentsFile | ContentsFile[]>(
    `/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
    { token },
  )

  if (Array.isArray(data)) throw new GitHubError(400, `${path} is a directory`)
  if (data.type !== 'file') throw new GitHubError(400, `${path} is not a file`)

  if (data.encoding === 'base64' && typeof data.content === 'string' && data.content.length > 0) {
    return { text: decodeBase64(data.content), sha: data.sha, size: data.size }
  }

  // Files above 1 MB come back without content: fetch the blob instead.
  const blob = await call<{ content: string; encoding: string; size: number }>(
    `/repos/${owner}/${repo}/git/blobs/${data.sha}`,
    { token },
  )
  return { text: decodeBase64(blob.content), sha: data.sha, size: blob.size ?? data.size }
}

export type WriteResult = { commitSha: string; contentSha: string }

export async function writeFile(
  token: string,
  owner: string,
  repo: string,
  input: { path: string; branch: string; text: string; message: string; sha?: string },
): Promise<WriteResult> {
  if (utf8Length(input.text) > 1_000_000) {
    throw new GitHubError(
      413,
      'Files above 1 MB cannot be written through the GitHub contents API.',
    )
  }

  const body: Record<string, unknown> = {
    message: input.message,
    content: encodeBase64(input.text),
    branch: input.branch,
  }
  if (input.sha) body.sha = input.sha

  const data = await call<{ content: { sha: string }; commit: { sha: string } }>(
    `/repos/${owner}/${repo}/contents/${encodePath(input.path)}`,
    { method: 'PUT', body, token },
  )

  return { commitSha: data.commit.sha, contentSha: data.content.sha }
}

/** Turns API errors into something worth reading in a toast. */
export function describeError(error: unknown): string {
  if (error instanceof GitHubError) {
    switch (error.status) {
      case 0:
        return error.message
      case 401:
        return 'GitHub rejected the token. Reconnect with a valid one.'
      case 403:
        return 'Forbidden. The token needs Contents: read and write on this repository.'
      case 404:
        return 'Not found. Check the repository name, the branch, and the token scopes.'
      case 409:
        return 'Conflict: the file changed on GitHub since you opened it. Reload it.'
      default:
        return `${error.message} (${error.status})`
    }
  }
  return error instanceof Error ? error.message : String(error)
}
