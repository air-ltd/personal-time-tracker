import { beforeEach, describe, expect, it } from 'vitest'
import {
  APP_KEY_STORAGE_KEY,
  BUILT_IN_KEYS,
  clearAppKey,
  describeKeySource,
  environmentForHost,
  hasLegacyStoredKey,
  isValidAppKey,
  readAppKey,
  selectBuiltInKey,
} from './appKey'

beforeEach(() => {
  window.localStorage.clear()
})

describe('app key validation', () => {
  it('accepts a short lowercase alphanumeric key', () => {
    expect(isValidAppKey('1a2b3c4d5e6f7g8')).toBe(true)
  })

  it('tolerates surrounding whitespace from a paste', () => {
    expect(isValidAppKey('  1a2b3c4d5e6f7g8  ')).toBe(true)
  })

  // Catches the mistakes people actually make: pasting a URL or a redirect URI.
  it('rejects a URL', () => {
    expect(isValidAppKey('https://console.dropbox.com')).toBe(false)
  })

  it('rejects something far too long to be a key', () => {
    expect(isValidAppKey('a'.repeat(200))).toBe(false)
  })

  it('rejects something far too short', () => {
    expect(isValidAppKey('abc')).toBe(false)
  })

  it('rejects empty input', () => {
    expect(isValidAppKey('')).toBe(false)
    expect(isValidAppKey('   ')).toBe(false)
  })
})

describe('reading the key', () => {
  // A build-time default must still work, so a configured deployment is unaffected by
  // this feature.
  it('falls back to the built-in key for this host', () => {
    // The test environment serves from localhost, which is not a production host.
    expect(readAppKey()).toBe(BUILT_IN_KEYS.development)
  })

  it('ignores an empty stored value rather than reporting a blank key', () => {
    window.localStorage.setItem(APP_KEY_STORAGE_KEY, '   ')
    expect(readAppKey()).toBe(BUILT_IN_KEYS.development)
  })
})

describe('a key saved by an earlier version', () => {
  // Regression: the saved key used to win over host selection, then pair with the
  // other Dropbox app's redirect URI. Dropbox reported that only as
  // "Invalid redirect_uri", naming neither half of the mismatch.
  it('is ignored when resolving the key', () => {
    window.localStorage.setItem(APP_KEY_STORAGE_KEY, 'somelegacykey1')
    expect(readAppKey()).toBe(BUILT_IN_KEYS.development)
  })

  it('does not change the reported source', () => {
    window.localStorage.setItem(APP_KEY_STORAGE_KEY, 'somelegacykey1')
    expect(describeKeySource().source).toBe('builtin')
  })

  it('is reported as leftover so it can be cleaned up', () => {
    expect(hasLegacyStoredKey()).toBe(false)
    window.localStorage.setItem(APP_KEY_STORAGE_KEY, 'somelegacykey1')
    expect(hasLegacyStoredKey()).toBe(true)
  })

  it('can be removed', () => {
    window.localStorage.setItem(APP_KEY_STORAGE_KEY, 'somelegacykey1')
    clearAppKey()
    expect(hasLegacyStoredKey()).toBe(false)
    expect(window.localStorage.getItem(APP_KEY_STORAGE_KEY)).toBeNull()
  })
})

describe('environment selection', () => {
  // The deployed site must use the production app, everything else the non-production
  // one. Choosing by host rather than by build mode matters because
  // `npm run preview` is a production build served from localhost, and it must not
  // touch production data.
  it.each([
    ['air-ltd.github.io', 'production'],
    ['sub.air-ltd.github.io', 'development'],
    ['localhost', 'development'],
    ['127.0.0.1', 'development'],
    ['example.com', 'development'],
    ['', 'development'],
  ])('maps %s to the %s environment', (hostname, expected) => {
    expect(environmentForHost(hostname)).toBe(expected)
  })

  it('gives each environment a different key', () => {
    expect(selectBuiltInKey('air-ltd.github.io')).toBe(BUILT_IN_KEYS.production)
    expect(selectBuiltInKey('localhost')).toBe(BUILT_IN_KEYS.development)
    expect(BUILT_IN_KEYS.production).not.toBe(BUILT_IN_KEYS.development)
  })

  it('ships keys that pass validation', () => {
    // A typo in a built-in key would only surface as a failed authorisation.
    expect(isValidAppKey(BUILT_IN_KEYS.production)).toBe(true)
    expect(isValidAppKey(BUILT_IN_KEYS.development)).toBe(true)
  })
})

describe('provenance', () => {
  it('reports the built-in key', () => {
    expect(describeKeySource()).toEqual({ source: 'builtin', environment: 'development' })
  })
})

describe('the key is a public value (0011 R5, 0012 AU3, AR6)', () => {
  // This is the justification for extending the localStorage allowlist beyond the
  // theme key: the value is an OAuth client id that ships in the bundle regardless.
  it('uses a single documented storage key', () => {
    expect(APP_KEY_STORAGE_KEY).toBe('tt:dropbox-app-key')
  })

  it('keeps no credentials in localStorage', () => {
    // Token and key are different things: the key is public; tokens are credentials
    // and live in IndexedDB. Keeping them separate makes the export exclusion
    // structural rather than a thing to remember.
    expect(JSON.stringify(window.localStorage)).not.toMatch(/access_token|refresh_token/)
  })
})
