import type { TimeEntry } from './types'
import { dayKey } from '../time/days'
import { entryDurationMs } from '../time/duration'

/**
 * Day grouping for the entry list (0004 L1).
 *
 * A day's subtotal is the sum of its entries' durations, so it reconciles exactly
 * with the rows beneath it (0006 RP2). Overlapping entries are permitted and both
 * counted (0004 O2): the day reading an implausible number is a data problem the
 * user should see, not one to hide.
 */
export interface DayGroup {
  key: string
  entries: TimeEntry[]
  /** Sum of entry durations, in ms. Null if any entry's duration is unrecoverable. */
  totalMs: number | null
}

export function groupEntriesByDay(entries: readonly TimeEntry[], now: Date): DayGroup[] {
  const buckets = new Map<string, TimeEntry[]>()

  for (const entry of entries) {
    if (entry.deletedAt !== null) continue // 0003 D2
    const start = Date.parse(entry.start)
    const anchor = Number.isNaN(start) ? new Date(entry.createdAt) : new Date(start)
    const key = dayKey(anchor)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(entry)
    else buckets.set(key, [entry])
  }

  const groups: DayGroup[] = []
  for (const [key, bucket] of buckets) {
    let total: number | null = 0
    for (const entry of bucket) {
      const ms = entryDurationMs(entry, now)
      if (ms === null) {
        total = null
        break
      }
      total += ms
    }
    groups.push({ key, entries: bucket, totalMs: total })
  }

  // Newest day first, newest entry first within a day.
  groups.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
  for (const group of groups) {
    group.entries.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0))
  }
  return groups
}

/** Newest day first, matching the list, so "today" is the first thing seen. */
export function sortEntriesForList(entries: readonly TimeEntry[]): TimeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.start === b.start) return a.createdAt < b.createdAt ? 1 : -1
    return a.start < b.start ? 1 : -1
  })
}
