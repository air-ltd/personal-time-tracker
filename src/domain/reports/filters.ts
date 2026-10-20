/**
 * Entry list filtering (0004 L3) and overlap marking (0004 O3).
 *
 * L3 is a MUST that had no phase until this one, and it belongs here because filtering
 * the list and breaking down a report are the same query — building one without the
 * other means writing it twice, and the two copies disagree.
 *
 * The filter is applied to the *entries*, not to a pre-grouped list, so the list and a
 * report over the same range always contain the same rows (0006 RP2).
 */

import { entryDurationMs } from '../time/duration'
import type { TimeEntry } from '../entries/types'
import type { Client, Project } from '../taxonomy/types'

/** The filter the user has set on the entry list. */
export interface EntryFilter {
  /** Null means "every project". */
  projectId: string | null
  /** Null means "every client". */
  clientId: string | null
  /** Empty means "every tag". An entry with no tags matches an empty filter. */
  tagIds: readonly string[]
  /** Null means "billable and non-billable alike". */
  billable: boolean | null
  /** Null means "timer and manual alike". */
  source: 'timer' | 'manual' | null
  /** Free text, matched against the note. Empty matches everything. */
  note: string
}

/** A filter that matches everything. */
export const NO_FILTER: EntryFilter = {
  projectId: null,
  clientId: null,
  tagIds: [],
  billable: null,
  source: null,
  note: '',
}

/** What the filter needs to know about the taxonomy. */
export interface FilterTaxonomy {
  projects: readonly Project[]
  clients: readonly Client[]
}

/**
 * Whether a filter is doing anything.
 *
 * The list shows a "filtered" state only when the filter actually excludes something,
 * so an empty filter does not announce itself as a filter over everything.
 */
export function isFilterActive(filter: EntryFilter): boolean {
  return (
    filter.projectId !== null ||
    filter.clientId !== null ||
    filter.tagIds.length > 0 ||
    filter.billable !== null ||
    filter.source !== null ||
    filter.note.trim() !== ''
  )
}

/**
 * Whether an entry matches the filter.
 *
 * The client filter resolves through the project, the same way a report's client split
 * does (0005 R3) — an entry whose project is missing belongs to no client and is
 * excluded when a client is selected, rather than being listed under every client.
 */
export function matchesFilter(
  entry: TimeEntry,
  filter: EntryFilter,
  taxonomy: FilterTaxonomy,
): boolean {
  if (filter.projectId !== null && entry.projectId !== filter.projectId) return false

  if (filter.clientId !== null) {
    const project =
      entry.projectId === null
        ? null
        : (taxonomy.projects.find((row) => row.id === entry.projectId) ?? null)
    const owner = project?.clientId ?? null
    if (owner !== filter.clientId) return false
  }

  if (filter.tagIds.length > 0) {
    // Every selected tag must be present. "All of" rather than "any of", so selecting
    // two tags narrows the list rather than widening it — which is what a reader
    // selecting two tags is asking for.
    for (const tagId of filter.tagIds) {
      if (!entry.tagIds.includes(tagId)) return false
    }
  }

  if (filter.billable !== null && entry.billable !== filter.billable) return false
  if (filter.source !== null && entry.source !== filter.source) return false

  if (filter.note.trim() !== '' && !noteMatches(entry.note, filter.note)) return false

  return true
}

/**
 * Whether a free-text note matches.
 *
 * Case-insensitive and substring, because the note is free text and the user is
 * looking for a word in it rather than for an exact phrase.
 */
function noteMatches(note: string, query: string): boolean {
  return note.toLowerCase().includes(query.trim().toLowerCase())
}

/** Filter a list of entries, keeping the order it arrived in. */
export function filterEntries(
  entries: readonly TimeEntry[],
  filter: EntryFilter,
  taxonomy: FilterTaxonomy,
): TimeEntry[] {
  if (!isFilterActive(filter)) return [...entries]
  return entries.filter((entry) => matchesFilter(entry, filter, taxonomy))
}

/**
 * An entry that overlaps another (0004 O3).
 *
 * Overlapping means the two share any time at all. The list marks these so a
 * deliberate double-booking is distinguishable from a mistake — the entries are not
 * wrong, they are just worth seeing.
 *
 * The comparison is in milliseconds on the UTC instants, and a running entry is
 * compared as running up to `now`, so a running entry that overlaps a finished one is
 * marked too.
 */
export interface OverlapMark {
  /** The entries that overlap each other, by id. */
  entryIds: Set<string>
}

/**
 * Find the entries that overlap others.
 *
 * The set is built pairwise rather than by a sweep, because the confirmed volume is
 * small (0006 P1, P5) and a pairwise pass is the one that cannot get the "same entry
 * twice" case wrong.
 */
export function findOverlaps(entries: readonly TimeEntry[], now: Date): OverlapMark {
  const entryIds = new Set<string>()
  const spans = entries
    .map((entry) => {
      const start = new Date(entry.start).getTime()
      const end = entry.end === null ? now.getTime() : new Date(entry.end).getTime()
      return { id: entry.id, start, end }
    })
    .filter(
      (span) => !Number.isNaN(span.start) && !Number.isNaN(span.end) && span.end > span.start,
    )

  for (let i = 0; i < spans.length; i += 1) {
    const a = spans[i]
    if (a === undefined) continue
    for (let j = i + 1; j < spans.length; j += 1) {
      const b = spans[j]
      if (b === undefined) continue
      if (a.start < b.end && b.start < a.end) {
        entryIds.add(a.id)
        entryIds.add(b.id)
      }
    }
  }

  return { entryIds }
}

/** The total duration of an entry, or null when it cannot be read. */
export function entryDuration(entry: TimeEntry, now: Date): number | null {
  return entryDurationMs(entry, now)
}
