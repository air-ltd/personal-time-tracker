import type { EntrySource, TimeEntry } from '../domain/entries/types'
import { newId } from '../domain/time/ids'
import { getDb, type AppDb } from './db'
import { bumpRevision } from './events'

/**
 * Entry repository.
 *
 * All entry persistence goes through here (0007 S5). Direct `IDBDatabase` access
 * from feature code is prohibited so that migrations, validation and change
 * notification cannot be bypassed.
 */

function db(): AppDb {
  return getDb()
}

function iso(value: Date): string {
  return value.toISOString()
}

/** Build a complete record. `end: null` means running (0003 E4). */
export function makeEntry(input: {
  start: Date
  end: Date | null
  note?: string
  source: EntrySource
  now: Date
  projectId?: string | null
  tagIds?: string[]
  billable?: boolean
  rateOverrideMinor?: number | null
}): TimeEntry {
  return {
    id: newId(),
    // Null and empty are the defaults, not placeholders: uncategorised is a legitimate
    // state with its own report bucket (0005 U1), and an entry must never be blocked on
    // inventing a project first (0005 P1).
    projectId: input.projectId ?? null,
    tagIds: input.tagIds ?? [],
    start: iso(input.start),
    end: input.end === null ? null : iso(input.end),
    note: input.note ?? '',
    billable: input.billable ?? false,
    rateOverrideMinor: input.rateOverrideMinor ?? null,
    source: input.source,
    createdAt: iso(input.now),
    updatedAt: iso(input.now),
    deletedAt: null,
  }
}

export async function putEntry(entry: TimeEntry): Promise<TimeEntry> {
  await db().entries.put(entry)
  bumpRevision()
  return entry
}

export async function getEntry(id: string): Promise<TimeEntry | undefined> {
  return db().entries.get(id)
}

/**
 * Active entries, newest start first. Soft-deleted rows are excluded here (0003 D2);
 * nothing user-facing should have to remember to filter them.
 */
export async function listEntries(): Promise<TimeEntry[]> {
  const all = await db().entries.toArray()
  return all
    .filter((entry) => entry.deletedAt === null)
    .sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0))
}

export async function listDeletedEntries(): Promise<TimeEntry[]> {
  const all = await db().entries.toArray()
  return all
    .filter((entry) => entry.deletedAt !== null)
    .sort((a, b) => {
      const x = a.deletedAt ?? ''
      const y = b.deletedAt ?? ''
      return x < y ? 1 : x > y ? -1 : 0
    })
}

/**
 * The single running entry, if any.
 *
 * Scans rather than using the `end` index, because IndexedDB does not index null
 * and a running entry's `end` is exactly that (0003 E4). At the confirmed volume
 * a scan is imperceptible; if entry counts ever reach tens of thousands the exit
 * path is an indexed numeric flag, not a different database.
 */
export async function findRunningEntry(): Promise<TimeEntry | undefined> {
  return db()
    .entries.filter((entry) => entry.deletedAt === null && entry.end === null)
    .first()
}

/**
 * Start the timer.
 *
 * Guarded so a second start cannot create a second running entry (0004 T1) even if
 * the UI is bypassed or clicked twice in the same tick.
 */
/**
 * Start a timer, optionally against a project.
 *
 * `projectId` comes from the client whose button was pressed (item 12 of
 * `SPECS/todo.md`), so the time is recorded against that client's default project without
 * anyone having to classify it afterwards. Null keeps the previous behaviour of an
 * uncategorised timer, which is still right for work with no client.
 */
export async function startTimer(
  now: Date,
  projectId: string | null = null,
): Promise<TimeEntry> {
  return db().transaction('rw', db().entries, async () => {
    const running = await findRunningEntry()
    if (running) return running
    return putEntry(makeEntry({ start: now, end: null, source: 'timer', projectId, now }))
  })
}

/**
 * Stop the timer.
 *
 * `now` is passed in and used for both the persisted end and the displayed duration
 * (0004 T3), so recomputing from a later tick cannot add or lose a second.
 */
export async function stopTimer(id: string, now: Date): Promise<TimeEntry | undefined> {
  return db().transaction('rw', db().entries, async () => {
    const entry = await getEntry(id)
    if (!entry || entry.deletedAt !== null) return undefined
    if (entry.end !== null) return entry
    const stopped: TimeEntry = { ...entry, end: iso(now), updatedAt: iso(now) }
    await putEntry(stopped)
    return stopped
  })
}

/** Start a timer, then immediately discard it. A mis-click leaves no zero record (0004 T6). */
export async function discardTimer(id: string, now: Date): Promise<void> {
  await db().transaction('rw', db().entries, async () => {
    const entry = await getEntry(id)
    if (!entry) return
    await db().entries.put({ ...entry, deletedAt: iso(now), updatedAt: iso(now) })
  })
  bumpRevision()
}

/**
 * Create a completed manual entry.
 *
 * `projectId` and `tagIds` are optional so a caller that does not care about taxonomy
 * need not know about it, and an uncategorised entry stays a legitimate first-class state
 * rather than requiring a project to be invented before anything can be recorded
 * (0005 U1, 0003 E1).
 */
export async function createManualEntry(input: {
  start: Date
  end: Date
  note: string
  now: Date
  projectId?: string | null
  tagIds?: string[]
  billable?: boolean
  rateOverrideMinor?: number | null
}): Promise<TimeEntry> {
  return putEntry(
    makeEntry({
      start: input.start,
      end: input.end,
      note: input.note,
      projectId: input.projectId ?? null,
      tagIds: input.tagIds ?? [],
      billable: input.billable ?? false,
      rateOverrideMinor: input.rateOverrideMinor ?? null,
      source: 'manual',
      now: input.now,
    }),
  )
}

/**
 * Patch an entry. Only `updatedAt` is managed here so callers cannot accidentally
 * rewrite a timestamp they did not mean to (0003 V2).
 */
export async function updateEntry(
  id: string,
  patch: Partial<
    Pick<
      TimeEntry,
      'start' | 'end' | 'note' | 'projectId' | 'tagIds' | 'billable' | 'rateOverrideMinor'
    >
  >,
  now: Date,
): Promise<TimeEntry | undefined> {
  return db().transaction('rw', db().entries, async () => {
    const entry = await getEntry(id)
    if (!entry || entry.deletedAt !== null) return undefined
    const updated: TimeEntry = { ...entry, ...patch, updatedAt: iso(now) }
    await putEntry(updated)
    return updated
  })
}

/**
 * Soft delete (0003 D1). Rows are retained so an accidental delete costs one
 * keystroke to undo rather than an hour of history.
 */
export async function softDeleteEntry(id: string, now: Date): Promise<TimeEntry | undefined> {
  return db().transaction('rw', db().entries, async () => {
    const entry = await getEntry(id)
    if (!entry || entry.deletedAt !== null) return undefined
    const deleted: TimeEntry = { ...entry, deletedAt: iso(now), updatedAt: iso(now) }
    await putEntry(deleted)
    return deleted
  })
}

/** Undo a soft delete (0003 D4). */
export async function restoreEntry(id: string, now: Date): Promise<TimeEntry | undefined> {
  return db().transaction('rw', db().entries, async () => {
    const entry = await getEntry(id)
    if (!entry || entry.deletedAt === null) return undefined
    const restored: TimeEntry = { ...entry, deletedAt: null, updatedAt: iso(now) }
    await putEntry(restored)
    return restored
  })
}
