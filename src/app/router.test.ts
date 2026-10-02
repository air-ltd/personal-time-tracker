import { describe, expect, it } from 'vitest'
import { matchPath, matchRoute, readPath } from './router'

describe('readPath', () => {
  // 0009 P3: a bare site root must resolve, and a deep hash with a query must
  // still match its route.
  it.each([
    ['', '/'],
    ['#', '/'],
    ['#/', '/'],
    ['#/reports', '/reports'],
    ['#/reports?range=week', '/reports'],
    ['#/reports/', '/reports'],
    ['#/?range=week', '/'],
  ])('normalises %o to %o', (hash, expected) => {
    expect(readPath(hash)).toBe(expected)
  })
})

describe('matchRoute', () => {
  const routes = [{ path: '/' }, { path: '/reports' }] as const

  it('finds an exact match', () => {
    expect(matchRoute('/reports', routes)?.path).toBe('/reports')
  })

  // 0002 R3: an unknown hash renders a not-found view, not an exception.
  it('returns undefined for an unrouted path', () => {
    expect(matchRoute('/nope', routes)).toBeUndefined()
  })
})

describe('matchPath with parameters', () => {
  const routes = [{ path: '/' }, { path: '/entries/new' }, { path: '/entries/:id' }] as const

  it('matches a static route', () => {
    expect(matchPath('/entries/new', routes)?.route.path).toBe('/entries/new')
  })

  it('captures a parameter', () => {
    const match = matchPath('/entries/abc-123', routes)
    expect(match?.route.path).toBe('/entries/:id')
    expect(match?.params.id).toBe('abc-123')
  })

  it('matches the root', () => {
    expect(matchPath('/', routes)?.route.path).toBe('/')
  })

  it('does not match a bare prefix', () => {
    expect(matchPath('/entries', routes)).toBeUndefined()
  })

  it('does not match a bare collection path', () => {
    // readPath strips a trailing slash first, so this is '/entries', which is
    // deliberately not a route rather than an entry with an empty id.
    expect(matchPath('/entries/', routes)).toBeUndefined()
    expect(matchPath('/entries', routes)).toBeUndefined()
  })

  it('decodes a percent-encoded parameter', () => {
    expect(matchPath('/entries/a%2Fb', routes)?.params.id).toBe('a/b')
  })

  it('prefers a static route over a parameter route', () => {
    expect(matchPath('/entries/new', routes)?.route.path).toBe('/entries/new')
  })
})
