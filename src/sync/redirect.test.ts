import { describe, expect, it } from 'vitest'
import { currentRedirectUri, deployedRedirectUri, DEPLOYED_ORIGIN } from './redirect'

/**
 * The redirect URI has to match what is registered with Dropbox exactly (0012 AU3).
 *
 * Dropbox's only complaint about a mismatch is `invalid_redirect_uri`, which names
 * neither half of the pair, so these are the values a user will copy and paste. They are
 * derived from `BASE_URL` rather than written out, because a written-out path stops
 * matching the moment the repository is renamed.
 */

describe('the deployed redirect URI', () => {
  it('follows the configured base path rather than a literal', () => {
    // In the test environment BASE_URL is `/`, so this asserts the shape. The important
    // property is that the path comes from configuration: a renamed repository gets a
    // matching path automatically instead of a URI that no longer exists.
    expect(deployedRedirectUri()).toBe(`${DEPLOYED_ORIGIN}/`)
    expect(deployedRedirectUri()).not.toContain('personal-time-tracker')
  })

  it('has a trailing slash, which Dropbox requires', () => {
    expect(currentRedirectUri().endsWith('/')).toBe(true)
    expect(deployedRedirectUri().endsWith('/')).toBe(true)
  })

  it('uses the current origin, so localhost and Pages each get their own', () => {
    expect(currentRedirectUri().startsWith(window.location.origin)).toBe(true)
    // Deliberately different from the deployed one during development, which is why the
    // panel shows both.
    expect(currentRedirectUri()).not.toBe(deployedRedirectUri())
  })

  it('is https when deployed, since GitHub Pages is', () => {
    expect(DEPLOYED_ORIGIN.startsWith('https://')).toBe(true)
  })
})
