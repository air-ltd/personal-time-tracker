import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDb, setDbForTests } from './db'
import { indexedDbTokenStore } from './secretsRepo'
import { readLastRev, writeLastRev, readLastSyncAt, writeLastSyncAt } from './snapshotRepo'
import { newId } from '../domain/time/ids'
import type { DropboxTokens } from '../sync/dropbox/DropboxProvider'

/**
 * The credential store and the sync bookkeeping helpers.
 *
 * These are low-coverage because most of their lines are defensive: they handle a
 * malformed or absent record rather than the happy path. That is exactly the code worth
 * covering here, since the failure mode is a user who appears disconnected with no way
 * to tell why, and a token store that must never leak.
 */

let db: AppDb
let counter = 0

beforeEach(async () => {
  db = new AppDb(`secrets-${(counter += 1)}`)
  setDbForTests(db)
  // Await the open so the schema upgrade chain has committed before the first
  // query. See useTimer.test.tsx: without this a query can arrive mid-upgrade and
  // Dexie reports an unhandled PrematureCommitError with no failing assertion.
  await db.open()
})

describe('indexedDbTokenStore', () => {
  const tokens: DropboxTokens = {
    accessToken: 'sl-token',
    expiresAt: 1_800_000_000_000,
    accountId: 'dbid:abc',
  }

  it('round-trips a token', async () => {
    await indexedDbTokenStore.write(tokens)
    expect(await indexedDbTokenStore.read()).toEqual(tokens)
  })

  it('reports nothing stored rather than failing', async () => {
    expect(await indexedDbTokenStore.read()).toBeNull()
  })

  it('clears', async () => {
    await indexedDbTokenStore.write(tokens)
    await indexedDbTokenStore.clear()
    expect(await indexedDbTokenStore.read()).toBeNull()
  })

  it('clearing twice is harmless', async () => {
    await indexedDbTokenStore.clear()
    await indexedDbTokenStore.clear()
    expect(await indexedDbTokenStore.read()).toBeNull()
  })

  /**
   * The stored record survives schema migrations and may have been written by another
   * build, so it is untrusted input. A malformed record reads as "not connected", which
   * prompts a reconnect rather than throwing on a shape mismatch.
   */
  describe('a malformed stored record reads as not connected', () => {
    it.each([
      ['not an object', 'a string'],
      ['null', null],
      ['missing accessToken', { refreshToken: 'only' }],
      ['an empty accessToken', { accessToken: '' }],
      ['a non-string accessToken', { accessToken: 42 }],
      ['an array', [{ accessToken: 'sl-token' }]],
    ])('%s', async (_label, value) => {
      await db.secrets.put({ key: 'dropbox-tokens', value })
      expect(await indexedDbTokenStore.read()).toBeNull()
    })
  })

  it('keeps only the fields it recognises, dropping anything unexpected', async () => {
    await db.secrets.put({
      key: 'dropbox-tokens',
      value: {
        ...tokens,
        scopes: ['files.content.read'],
        // A refresh token from a build that stored one. Kept out of the type deliberately:
        // there is no refresh flow, so carrying it would imply a capability the app does
        // not have. A record written by an older build is still read without it.
        refreshToken: 'legacy-refresh-token',
        displayName: 'Someone',
        evil: 'ignored',
      },
    })

    const read = await indexedDbTokenStore.read()

    expect(read).toEqual(tokens)
    // A field this build does not understand is not carried forward, so it cannot be
    // acted on or displayed as though it were.
    expect(read).not.toHaveProperty('scopes')
    expect(read).not.toHaveProperty('refreshToken')
    expect(read).not.toHaveProperty('displayName')
  })

  it('treats absent optional fields as absent rather than as undefined values', async () => {
    await db.secrets.put({ key: 'dropbox-tokens', value: { accessToken: 'sl-token' } })

    expect(await indexedDbTokenStore.read()).toEqual({ accessToken: 'sl-token' })
  })
})

describe('sync bookkeeping', () => {
  it('round-trips the last revision', async () => {
    await writeLastRev('rev-123')
    expect(await readLastRev()).toBe('rev-123')
  })

  it('reports no revision before the first sync', async () => {
    expect(await readLastRev()).toBeNull()
  })

  it('clears the revision when given null, rather than storing one', async () => {
    await writeLastRev('rev-123')
    await writeLastRev(null)
    expect(await readLastRev()).toBeNull()
  })

  it('replaces rather than accumulating revisions', async () => {
    await writeLastRev('rev-1')
    await writeLastRev('rev-2')
    expect(await readLastRev()).toBe('rev-2')
  })

  it('ignores a stored revision of the wrong type', async () => {
    await db.meta.put({ key: 'sync:lastRev', value: 42 })
    // Untrusted input: a number cannot be a revision, and coercing it would produce a
    // comparison that silently never matches.
    expect(await readLastRev()).toBeNull()
  })

  it('round-trips the last sync time', async () => {
    await writeLastSyncAt('2026-10-13T09:00:00.000Z')
    expect(await readLastSyncAt()).toBe('2026-10-13T09:00:00.000Z')
  })

  it('reports no sync time before the first sync', async () => {
    expect(await readLastSyncAt()).toBeNull()
  })
})

describe('newId', () => {
  /**
   * The fallback paths only run where `crypto.randomUUID` is unavailable, which is
   * exactly the environment the developer is least likely to be in. Left untested they
   * are the sort of code that breaks silently on someone else's machine.
   */
  const originalCrypto = globalThis.crypto

  function withCrypto(value: unknown, run: () => void): void {
    Object.defineProperty(globalThis, 'crypto', { value, configurable: true })
    try {
      run()
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true })
    }
  }

  it('produces distinct ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newId()))
    expect(ids.size).toBe(50)
  })

  it('looks like a uuid', () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('falls back to getRandomValues, producing valid distinct v4 ids', () => {
    withCrypto({ getRandomValues: (a: Uint8Array) => a.fill(3) }, () => {
      const id = newId()
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
      // Version and variant are pinned regardless of the bytes supplied, so a uniform
      // fill still yields a well-formed id rather than an obviously wrong one. These two
      // nibbles were previously the wrong way round, producing version 8 and variant 4.
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
      expect(id).toContain('-4303-83')
      // Two ids from the same generator must not be identical in a way that collides.
      expect(newId()).toBe(newId())
    })
  })

  it('throws rather than returning a guess when there is no random source', () => {
    // Returning a predictable id here would be worse: ids must be unguessable because
    // two devices can create entries in the same millisecond (0003 P4).
    withCrypto(undefined, () => {
      expect(() => newId()).toThrow(/random source/i)
    })
  })
})
