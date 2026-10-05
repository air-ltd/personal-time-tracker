import { afterEach } from 'vitest'
import { AppDb, peekDb, setDbForTests } from '../storage/db'
import { resetRevisionForTests } from '../storage/events'

let counter = 0

/**
 * Fresh database per test.
 *
 * Each test needs an isolated store: entries persist in IndexedDB, so sharing one
 * database would leak state between tests and make ordering significant.
 *
 * The previous one is closed rather than abandoned. `fake-indexeddb` keeps a real open
 * connection per instance, and at 769 tests that is 769 of them — harmless now, and a
 * slow memory leak that eventually shows up as flakiness nobody can attribute. Closing is
 * deferred to the end of the test so `await db.open()` inside a test body still behaves
 * as written.
 */
export function installTestDb(): AppDb {
  const previous = peekDb()
  const db = new AppDb(`test-${(counter += 1)}-${Math.random().toString(36).slice(2, 8)}`)
  setDbForTests(db)
  resetRevisionForTests()
  afterEach(() => {
    // `isOpen()` rather than an unconditional close: Dexie throws on closing a database
    // that was never opened, which several tests do not do.
    if (previous?.isOpen()) void previous.close()
  })
  return db
}
