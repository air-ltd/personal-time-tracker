import { useSyncExternalStore } from 'react'

/**
 * Minimal hash-based router.
 *
 * Hash routing is a forced choice, not a preference (0002 R1): GitHub Pages
 * performs no request rewriting, so a path like `/reports` is a hard 404. The
 * fragment never reaches the server.
 *
 * Deliberately hand-rolled rather than a dependency. The app needs a route table
 * and a not-found case, and DEP3 asks that direct dependencies stay few.
 */

export interface Route {
  path: string
}

/** Reads the current path from `location.hash`, normalising the root. */
export function readPath(hash: string): string {
  if (hash === '' || hash === '#' || hash === '#/') {
    return '/'
  }
  const withoutSigil = hash.startsWith('#') ? hash.slice(1) : hash
  // Strip any query string so `#/reports?range=week` matches route `/reports`.
  const queryStart = withoutSigil.indexOf('?')
  const path = queryStart === -1 ? withoutSigil : withoutSigil.slice(0, queryStart)
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function getSnapshot(): string {
  return readPath(window.location.hash)
}

export function navigate(to: string): void {
  window.location.hash = to
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function matchRoute(path: string, routes: readonly Route[]): Route | undefined {
  return routes.find((route) => route.path === path)
}

export interface RouteMatch {
  route: Route
  params: Readonly<Record<string, string>>
}

/**
 * Match a path against patterns containing `:param` segments, for example
 * `/entries/:id`.
 *
 * An empty match is `undefined` rather than a route with empty params, so a bare
 * `/entries/` cannot accidentally open an entry whose id is "".
 */
export function matchPath(path: string, routes: readonly Route[]): RouteMatch | undefined {
  const segments = path.split('/').filter(Boolean)
  for (const route of routes) {
    const pattern = route.path.split('/').filter(Boolean)
    if (pattern.length !== segments.length) continue

    const params: Record<string, string> = {}
    let matched = true
    for (let i = 0; i < pattern.length; i += 1) {
      const part = pattern[i] ?? ''
      const actual = segments[i] ?? ''
      if (part.startsWith(':')) {
        if (!actual) {
          matched = false
          break
        }
        params[part.slice(1)] = decodeURIComponent(actual)
      } else if (part !== actual) {
        matched = false
        break
      }
    }
    if (matched) return { route, params }
  }
  return undefined
}
