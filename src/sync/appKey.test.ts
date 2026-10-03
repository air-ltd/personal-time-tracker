import { beforeEach, describe, expect, it } from 'vitest'
import {
  APP_KEY_STORAGE_KEY,
  clearAppKey,
  isKeyFromEnvironment,
  isValidAppKey,
  readAppKey,
  writeAppKey,
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
  it('returns the stored key when there is one', () => {
    window.localStorage.setItem(APP_KEY_STORAGE_KEY, 'storedkey1234')
    expect(readAppKey()).toBe('storedkey1234')
  })

  // A build-time default must still work, so a configured deployment is unaffected by
  // this feature.
  it('falls back to the environment when nothing is stored', () => {
    // No VITE_DROPBOX_APP_KEY in the test environment, so the fallback is empty.
    expect(readAppKey()).toBe('')
  })

  it('ignores an empty stored value rather than reporting a blank key', () => {
    window.localStorage.setItem(APP_KEY_STORAGE_KEY, '   ')
    expect(readAppKey()).toBe('')
  })
})

describe('writing the key', () => {
  it('stores a valid key and reports success', () => {
    expect(writeAppKey('1a2b3c4d5e6f7g8')).toBe(true)
    expect(window.localStorage.getItem(APP_KEY_STORAGE_KEY)).toBe('1a2b3c4d5e6f7g8')
  })

  it('trims before storing, so a pasted newline is not kept', () => {
    writeAppKey('  1a2b3c4d5e6f7g8\n')
    expect(window.localStorage.getItem(APP_KEY_STORAGE_KEY)).toBe('1a2b3c4d5e6f7g8')
  })

  it('refuses to store an invalid key', () => {
    expect(writeAppKey('not a key')).toBe(false)
    expect(window.localStorage.getItem(APP_KEY_STORAGE_KEY)).toBeNull()
  })
})

describe('forgetting the key', () => {
  it('removes it', () => {
    writeAppKey('1a2b3c4d5e6f7g8')
    clearAppKey()
    expect(window.localStorage.getItem(APP_KEY_STORAGE_KEY)).toBeNull()
    expect(readAppKey()).toBe('')
  })
})

describe('provenance', () => {
  it('reports a stored key as user-supplied', () => {
    writeAppKey('1a2b3c4d5e6f7g8')
    expect(isKeyFromEnvironment()).toBe(false)
  })

  it('reports no key at all rather than blaming the environment', () => {
    expect(isKeyFromEnvironment()).toBe(false)
  })
})

describe('the key is a public value (0011 R5, 0012 AU3, AR6)', () => {
  // This is the justification for extending the localStorage allowlist beyond the
  // theme key: the value is an OAuth client id that ships in the bundle regardless.
  it('is stored under a single documented key', () => {
    writeAppKey('1a2b3c4d5e6f7g8')
    const keys = Object.keys(window.localStorage)
    expect(keys).toContain(APP_KEY_STORAGE_KEY)
    expect(APP_KEY_STORAGE_KEY).toBe('tt:dropbox-app-key')
  })

  it('never lands in the secrets store, which holds tokens', () => {
    // Token and key are different things: the key is public and lives in
    // localStorage; tokens are credentials and live in IndexedDB. Keeping them
    // separate is what makes the export exclusion structural.
    writeAppKey('1a2b3c4d5e6f7g8')
    expect(JSON.stringify(window.localStorage)).not.toMatch(/access_token|refresh_token/)
  })
})
