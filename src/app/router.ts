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

export interface RouteMatch {
  route: Route
  params: Readonly<Record<string, string>>
}

/**
 * Percent-decode one path segment, tolerating a malformed escape.
 *
 * A hand-edited or truncated hash can carry `%` with nothing usable after it, and
 * `decodeURIComponent` throws on that. Returning the raw segment is better than failing to
 * match: the route then renders its own not-found view instead of the whole app breaking.
 */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
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
        // `decodeURIComponent` throws on a malformed escape such as a bare `%` or
        // `%zz`. A hash is user-editable, so this is reachable input rather than a
        // theoretical one, and an uncaught throw here would take down the whole app on
        // navigation. The raw segment is a better outcome than a crash: the route simply
        // will not match an entry, and the not-found view says so.
        params[part.slice(1)] = decodeSegment(actual)
      } else if (part !== actual) {
        matched = false
        break
      }
    }
    if (matched) return { route, params }
  }
  return undefined
}
