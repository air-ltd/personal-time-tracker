import { AppDb, setDbForTests } from '../storage/db'
import { resetRevisionForTests } from '../storage/events'

let counter = 0

/**
 * Fresh database per test.
 *
 * Each test needs an isolated store: entries persist in IndexedDB, so sharing one
 * database would leak state between tests and make ordering significant.
 */
export function installTestDb(): AppDb {
  const db = new AppDb(`test-${(counter += 1)}-${Math.random().toString(36).slice(2, 8)}`)
  setDbForTests(db)
  resetRevisionForTests()
  return db
}
