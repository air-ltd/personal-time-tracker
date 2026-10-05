import { entryDurationMs } from '../time/duration'
import { dayKey, localDayBounds, weekKeyFromDayKey } from '../time/days'
import { dayHeading } from './dayHeading'
import type { TimeEntry } from './types'
import type { Project } from '../taxonomy/types'
import type { Client } from '../taxonomy/types'

/**
 * Entry summaries for the period control (items 21 and 22 of `SPECS/todo.md`).
 *
 * Item 21 asks for a client to be selectable and the entries filtered by it — and says
 * that if a timer is active for a client the entries should be filtered to that client.
 * Item 22 asks for a period setting, daily / weekly / all, where "daily" and "weekly"
 * summarise to that level *per client*.
 *
 * Both axes are handled by one function rather than "filter, then summarise". Filtering
 * afterwards would let a summary disagree with the rows above it, which is the failure
 * 0006 RP2 exists to prevent.
 *
 * The shape is the same in all three periods — a list of buckets, each holding a row per
 * client — because a summary that reorganises itself when the control changes has to be
 * re-read every time the control is touched.
 */

export type Period = 'day' | 'week' | 'all'

export const PERIODS: readonly Period[] = ['day', 'week', 'all']

export const PERIOD_LABELS: Record<Period, string> = {
  day: 'Daily',
  week: 'Weekly',
  all: 'All',
}

/** One line of a summary: a client, or nothing at all when the work has no client. */
export interface SummaryRow {
  /** Null for uncategorised, which is a visible state rather than "unknown" (0005 U1). */
  clientId: string | null
  clientName: string
  /** `#rrggbb`, or null where there is no client to take a colour from. */
  colour: string | null
  /**
   * Null when any entry in this row has an unrecoverable duration.
   *
   * The same rule `groupEntriesByDay` applies, and it has to: this module's own rationale
   * is that one function handles both axes so "a summary cannot disagree with the rows
   * above it", which is 0006 RP2. Coercing an unknown duration to zero reported a confident
   * total that silently omitted the entry while the list above showed `—` for the same
   * day — the exact disagreement the design exists to prevent, and the one case where
   * telling the user is right rather than merely cautious.
   */
  totalMs: number | null
  entryCount: number
  /** The projects involved, named so the line is meaningful without opening it. */
  projectNames: string[]
}

export interface SummaryBucket {
  /** The day this bucket covers. Null for weekly and all-entries. */
  dayKey: string | null
  label: string
  rows: SummaryRow[]
  /** Null when any row's total is null — see `SummaryRow.totalMs`. */
  totalMs: number | null
}

const UNCATEGORISED = 'Uncategorised'

/** What the list needs to know to filter and summarise in one pass. */
export interface SummaryInput {
  entries: readonly TimeEntry[]
  projects: readonly Project[]
  clients: readonly Client[]
  period: Period
  /** The selected client, or null for "everything". */
  clientId: string | null
  /** Used for a still-running entry's elapsed time, so the summary matches the list. */
  now: Date
}

export function summariseEntries({
  entries,
  projects,
  clients,
  period,
  clientId,
  now,
}: SummaryInput): SummaryBucket[] {
  const projectById = new Map(projects.map((row) => [row.id, row]))
  const clientById = new Map(clients.map((row) => [row.id, row]))

  /**
   * Which client an entry belongs to, resolved through its project.
   *
   * An entry whose project is missing or deleted resolves to nobody and lands in the
   * uncategorised row. Dropping it would make the summary's total disagree with the list
   * above it, which is the whole failure this function is shaped to avoid.
   */
  const ownerOf = (entry: TimeEntry): string | null => {
    if (entry.projectId === null) return null
    return projectById.get(entry.projectId)?.clientId ?? null
  }

  const kept = entries.filter((entry) => clientId === null || ownerOf(entry) === clientId)

  if (period === 'all') {
    const rows = rowsFor(kept, ownerOf, clientById, projectById, now)
    return [
      {
        dayKey: null,
        label: 'All entries',
        rows,
        totalMs: totalOf(rows),
      },
    ]
  }

  const byDay = new Map<string, TimeEntry[]>()
  for (const entry of kept) {
    const key = safeDayKey(entry.start)
    // A corrupt timestamp is skipped rather than thrown on: it comes from a backup or from
    // replication, and one bad row must not take the whole summary down.
    if (key === null) continue
    const list = byDay.get(key)
    if (list) list.push(entry)
    else byDay.set(key, [entry])
  }
  const keys = [...byDay.keys()].sort((a, b) => b.localeCompare(a))

  if (period === 'day') {
    return keys.map((key) => {
      const rows = rowsFor(byDay.get(key) ?? [], ownerOf, clientById, projectById, now)
      return { dayKey: key, label: dayHeading(key), rows, totalMs: totalOf(rows) }
    })
  }

  // Weekly, one bucket per week, labelled by the Monday that starts it. Labelling by a
  // date inside the week would be ambiguous in any month with two of them.
  const byWeek = new Map<string, TimeEntry[]>()
  for (const key of keys) {
    const week = weekKeyFromDayKey(key)
    if (week === null) continue
    byWeek.set(week, [...(byWeek.get(week) ?? []), ...(byDay.get(key) ?? [])])
  }

  return [...byWeek.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([week, weekEntries]) => {
      const rows = rowsFor(weekEntries, ownerOf, clientById, projectById, now)
      return {
        dayKey: null,
        label: `Week of ${weekHeading(week)}`,
        rows,
        totalMs: totalOf(rows),
      }
    })
}

/**
 * Sum the rows, propagating an unknown rather than absorbing it.
 *
 * `reduce` with `+` would coerce null to 0 and hand back a plausible number for a period
 * containing something unreadable, which is the failure being fixed.
 */
function totalOf(rows: SummaryRow[]): number | null {
  let total = 0
  for (const row of rows) {
    if (row.totalMs === null) return null
    total += row.totalMs
  }
  return total
}

function rowsFor(
  entries: readonly TimeEntry[],
  ownerOf: (entry: TimeEntry) => string | null,
  clientById: Map<string, Client>,
  projectById: Map<string, Project>,
  now: Date,
): SummaryRow[] {
  const buckets = new Map<
    string | null,
    { totalMs: number | null; count: number; projects: Set<string> }
  >()

  for (const entry of entries) {
    const owner = ownerOf(entry)
    const bucket = buckets.get(owner) ?? { totalMs: 0, count: 0, projects: new Set<string>() }
    // `entryDurationMs` reads the entry's own end when it has one and falls back to `now`
    // when it is still running, so a live entry counts up in step with the list.
    //
    // A null duration poisons the bucket rather than counting as zero: see
    // `SummaryRow.totalMs`. Once poisoned it stays poisoned, so the sum is not a partial
    // figure presented as a whole.
    const ms = entryDurationMs(entry, now)
    bucket.totalMs = bucket.totalMs === null || ms === null ? null : bucket.totalMs + ms
    bucket.count += 1
    if (entry.projectId !== null) {
      const name = projectById.get(entry.projectId)?.name
      if (name !== undefined) bucket.projects.add(name)
    }
    buckets.set(owner, bucket)
  }

  return (
    [...buckets.entries()]
      .map(([id, bucket]) => ({
        clientId: id,
        // Falls back to the placeholder when the client id does not resolve, so the row is
        // still there with its time rather than silently disappearing.
        clientName: id === null ? UNCATEGORISED : (clientById.get(id)?.name ?? UNCATEGORISED),
        colour: id === null ? null : (clientById.get(id)?.colour ?? null),
        totalMs: bucket.totalMs,
        entryCount: bucket.count,
        projectNames: [...bucket.projects].sort((a, b) => a.localeCompare(b)),
      }))
      // Clients first, uncategorised last: the named ones are what the reader came for.
      .sort((a, b) =>
        a.clientId === null
          ? 1
          : b.clientId === null
            ? -1
            : a.clientName.localeCompare(b.clientName),
      )
  )
}

function safeDayKey(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return dayKey(date)
}

function weekHeading(weekKeyValue: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(localDayBounds(weekKeyValue).start)
  } catch {
    return weekKeyValue
  }
}
