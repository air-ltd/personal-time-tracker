import { describe, expect, it } from 'vitest'
import { matchRoute, readPath } from './router'

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
