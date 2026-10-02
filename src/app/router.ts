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
