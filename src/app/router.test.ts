import { describe, expect, it } from 'vitest'
import { matchPath, readPath } from './router'

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

/**
 * A malformed escape in the hash (0002 R1).
 *
 * The hash is user-editable, so a bare `%` reaches the router. `decodeURIComponent`
 * throws on that, and an uncaught throw during navigation takes down the whole app — so
 * the not-found view is the right outcome, not a crash.
 */
const ROUTES = [{ path: '/' }, { path: '/entries/:id' }]

describe('malformed percent-escapes', () => {
  it.each(['%', '%zz', 'abc%', '%E0%A4%A'])('does not throw on %j', (segment) => {
    expect(() => matchPath(`/entries/${segment}`, ROUTES)).not.toThrow()
  })

  it('matches with the raw segment, so the form reports not found', () => {
    // Keeping the raw segment means the route still matches and the edit form resolves
    // the id, finds nothing, and renders its "Entry not found" view with a way back.
    // Dropping the route entirely would also be defensible; what matters is that neither
    // path throws.
    expect(matchPath('/entries/%zz', ROUTES)?.params['id']).toBe('%zz')
  })

  it('still decodes a valid escape', () => {
    const match = matchPath('/entries/a%20b', ROUTES)
    expect(match?.params['id']).toBe('a b')
  })
})
