import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

function commit(ref: string): string {
  return execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    encoding: 'utf8',
  }).trim()
}

function versionAt(ref: string): string {
  const packageJson = execFileSync('git', ['show', `${ref}:package.json`], {
    encoding: 'utf8',
  })
  return (JSON.parse(packageJson) as { version: string }).version
}

describe('release version on feature branches', () => {
  it('requires a version bump before merging changes into main', () => {
    if (commit('HEAD') === commit('main')) return

    expect(versionAt('HEAD')).not.toBe(versionAt('main'))
  })
})
