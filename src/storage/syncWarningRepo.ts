/**
 * Device-local state for the sync warning (item 86 of `SPECS/todo.md`).
 *
 * Both values live in `meta` rather than `settings` because they describe this
 * browser, not the user's data: a snooze copied to another device would hide a
 * failure the user has not seen, and a lost-connection marker copied there would
 * warn about a connection that device may still have. `meta` is excluded from
 * sync payloads and backups (see `snapshotRepo.ts`).
 */
import { getDb } from './db'

const WARNING_SNOOZE_KEY = 'sync:warningSnoozedUntil'
const CONNECTION_LOST_KEY = 'sync:connectionLost'

export async function readSyncWarningSnoozedUntil(): Promise<number | null> {
  const record = await getDb().meta.get(WARNING_SNOOZE_KEY)
  return typeof record?.value === 'number' && Number.isFinite(record.value)
    ? record.value
    : null
}

export async function writeSyncWarningSnoozedUntil(timestamp: number): Promise<void> {
  await getDb().meta.put({ key: WARNING_SNOOZE_KEY, value: timestamp })
}

export async function readSyncConnectionLost(): Promise<boolean> {
  const record = await getDb().meta.get(CONNECTION_LOST_KEY)
  return record?.value === true
}

export async function writeSyncConnectionLost(lost: boolean): Promise<void> {
  if (lost) await getDb().meta.put({ key: CONNECTION_LOST_KEY, value: true })
  else await getDb().meta.delete(CONNECTION_LOST_KEY)
}
