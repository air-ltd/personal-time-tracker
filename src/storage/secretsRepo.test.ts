import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDb, setDbForTests } from './db'
import { indexedDbTokenStore } from './secretsRepo'
import { readLastRev, writeLastRev, readLastSyncAt, writeLastSyncAt } from './snapshotRepo'
import { newId } from '../domain/time/ids'

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
  /**
   * A store that knows nothing about credentials.
   *
   * The parsing moved to `DropboxProvider.toTokens`, because only the provider knows what
   * a token for it looks like — which is what lets a second provider be added without
   * touching this file. So these tests assert the one thing that is still this layer's
   * responsibility: the value survives a round trip through IndexedDB unaltered, whatever
   * it is, and nothing leaks or disappears on the way.
   */
  const credentials = { accessToken: 'sl-token', expiresAt: 1_800_000_000_000 }

  it('round-trips a value unaltered', async () => {
    await indexedDbTokenStore.write(credentials)
    expect(await indexedDbTokenStore.read()).toEqual(credentials)
  })

  it('round-trips values it has no vocabulary for', async () => {
    // A provider this build does not know about may have written here. Refusing to
    // store what it does not recognise would make the table a Dropbox concept again.
    for (const value of [
      null,
      'a string',
      42,
      [{ a: 1 }],
      { scopes: ['files.content.read'] },
    ]) {
      await indexedDbTokenStore.write(value)
      expect(await indexedDbTokenStore.read()).toEqual(value)
    }
  })

  it('reports nothing stored rather than failing', async () => {
    expect(await indexedDbTokenStore.read()).toBeNull()
  })

  it('clears', async () => {
    await indexedDbTokenStore.write(credentials)
    await indexedDbTokenStore.clear()
    expect(await indexedDbTokenStore.read()).toBeNull()
  })

  it('clearing twice is harmless', async () => {
    await indexedDbTokenStore.clear()
    await indexedDbTokenStore.clear()
    expect(await indexedDbTokenStore.read()).toBeNull()
  })

  it('distinguishes no record from a record holding null', async () => {
    // Both read as `null`, and that is right: "nothing is connected" is the same answer
    // either way, and the provider decides what a null means.
    await db.secrets.put({ key: 'dropbox-tokens', value: null })
    expect(await indexedDbTokenStore.read()).toBeNull()
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
