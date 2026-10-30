import { parseRepoLink } from './githubUrl'

export type Route = { owner: string; repo: string; branch?: string; path?: string }

export function readRoute(): Route | null {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (!hash) return null

  const link = parseRepoLink(hash)
  if (!link) return null

  return { owner: link.owner, repo: link.repo, branch: link.branch, path: link.path }
}

export function routeToHash(route: Route): string {
  const base = `/${route.owner}/${route.repo}`
  const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

  if (route.path) {
    return `#${base}/blob/${encodeURIComponent(route.branch ?? 'HEAD')}/${encodePath(route.path)}`
  }
  if (route.branch) return `#${base}/tree/${encodeURIComponent(route.branch)}`
  return `#${base}`
}

export function repoRoute(route: Route): Route {
  return { owner: route.owner, repo: route.repo, branch: route.branch }
}

export function fileRoute(route: Route, branch: string, path: string): Route {
  return { owner: route.owner, repo: route.repo, branch, path }
}
