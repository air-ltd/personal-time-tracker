import { beforeEach, describe, expect, it } from 'vitest'
import { installTestDb } from '../test/harness'
import {
  readSyncConnectionLost,
  readSyncWarningSnoozedUntil,
  writeSyncConnectionLost,
  writeSyncWarningSnoozedUntil,
} from './syncWarningRepo'

let db: ReturnType<typeof installTestDb>

beforeEach(() => {
  db = installTestDb()
})

describe('sync warning device-local state', () => {
  it('round-trips the snooze expiry without writing a synced setting', async () => {
    const until = Date.now() + 5 * 60 * 60 * 1000
    await writeSyncWarningSnoozedUntil(until)

    expect(await readSyncWarningSnoozedUntil()).toBe(until)
    expect(await db.settings.count()).toBe(0)
  })

  it('ignores malformed snooze values', async () => {
    await db.meta.put({ key: 'sync:warningSnoozedUntil', value: 'later' })

    expect(await readSyncWarningSnoozedUntil()).toBeNull()
  })

  it('remembers a lost connection and clears the marker on recovery', async () => {
    await writeSyncConnectionLost(true)
    expect(await readSyncConnectionLost()).toBe(true)

    await writeSyncConnectionLost(false)
    expect(await readSyncConnectionLost()).toBe(false)
  })
})
