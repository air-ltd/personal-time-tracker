import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { AppDb, setDbForTests } from './db'
import { bumpRevision, getRevision, resetRevisionForTests, subscribe } from './events'

/**
 * The notification must not fire while a transaction is open.
 *
 * A bump inside a transaction tells the views to re-read, and a re-read issued in
 * that window joins the transaction. The view then sees rows the transaction has not
 * committed, and a read of a store the transaction did not declare makes the
 * transaction fail — so the write is rolled back after the interface has already
 * shown it.
 */
describe('a revision bump inside a transaction', () => {
  it('is deferred until the transaction has committed', async () => {
    const db = new AppDb(`events-test-${Math.random().toString(36).slice(2, 8)}`)
    setDbForTests(db)
    resetRevisionForTests()

    const listener = vi.fn()
    const unsubscribe = subscribe(listener)

    try {
      await db.transaction('rw', db.entries, async () => {
        bumpRevision()
        // The listener has not been told yet: the transaction is still open.
        expect(listener).not.toHaveBeenCalled()
        await Promise.resolve()
      })

      // Now the transaction has committed, and the views have been told.
      expect(listener).toHaveBeenCalledTimes(1)
      expect(getRevision()).toBe(1)
    } finally {
      unsubscribe()
      db.close()
    }
  })

  it('is deferred across an await inside the transaction', async () => {
    const db = new AppDb(`events-test-${Math.random().toString(36).slice(2, 8)}`)
    setDbForTests(db)
    resetRevisionForTests()

    const listener = vi.fn()
    const unsubscribe = subscribe(listener)

    try {
      await db.transaction('rw', db.entries, async () => {
        // The point of the fix: the context has to survive the await, or the
        // notification would fire inside the transaction again.
        await Promise.resolve()
        bumpRevision()
        expect(listener).not.toHaveBeenCalled()
      })

      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribe()
      db.close()
    }
  })

  it('still tells the views when the transaction is rolled back', async () => {
    const db = new AppDb(`events-test-${Math.random().toString(36).slice(2, 8)}`)
    setDbForTests(db)
    resetRevisionForTests()

    const listener = vi.fn()
    const unsubscribe = subscribe(listener)

    try {
      await expect(
        db.transaction('rw', db.entries, async () => {
          bumpRevision()
          await Promise.resolve()
          throw new Error('rollback')
        }),
      ).rejects.toThrow('rollback')

      // The data changed and then changed back, so the views still need to hear
      // about it — they may have read the uncommitted state. The abort event fires
      // after the rejection propagates, so this waits for it rather than assuming
      // it has already happened.
      await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    } finally {
      unsubscribe()
      db.close()
    }
  })

  it('tells the views immediately when there is no transaction', () => {
    resetRevisionForTests()
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)

    try {
      expect(Dexie.currentTransaction).toBeNull()
      bumpRevision()
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribe()
    }
  })
})
