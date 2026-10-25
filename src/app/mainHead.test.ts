import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

function commit(ref: string): string {
  return execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    encoding: 'utf8',
  }).trim()
}

describe('main branch checkout', () => {
  it('is running at the current main HEAD commit', () => {
    expect(commit('HEAD')).toBe(commit('main'))
  })
})
