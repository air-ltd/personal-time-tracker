import { groupEntriesByDay } from '../../domain/entries/group'
import { formatClock, formatDuration, entryDurationMs } from '../../domain/time/duration'
import { localDayBounds } from '../../domain/time/days'
import type { TimeEntry } from '../../domain/entries/types'
import { useEntries } from './useEntries'

/**
 * Entry list, grouped by local day with per-day subtotals (0004 L1–L2).
 *
 * The subtotal is the sum of the rows beneath it, so the two can never disagree
 * (0006 RP2). Overlapping entries are both counted (0004 O2): a day reading more
 * than 24 hours is a data problem the user should see.
 */
export function EntryList({ now }: { now: Date }) {
  const { entries, loading } = useEntries()
  const groups = groupEntriesByDay(entries, now)

  if (loading) return <p className="hint">Loading…</p>

  if (groups.length === 0) {
    return (
      <p className="hint" data-testid="empty-state">
        No entries yet. Start the timer above, or add one by hand.
      </p>
    )
  }

  return (
    <div className="day-groups">
      {groups.map((group) => (
        <section key={group.key} className="day-group" aria-label={heading(group.key)}>
          <header className="day-header">
            <h3>{heading(group.key)}</h3>
            <span className="day-total" data-testid={`day-total-${group.key}`}>
              {formatDuration(group.totalMs)}
            </span>
          </header>
          {/* Named so it is distinguishable from any other list on the page, both
              for assistive tech and for tests that count rows. */}
          <ul className="entry-rows" aria-label={`Entries for ${heading(group.key)}`}>
            {group.entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} now={now} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function EntryRow({ entry, now }: { entry: TimeEntry; now: Date }) {
  const start = new Date(entry.start)
  const end = entry.end === null ? null : new Date(entry.end)
  const duration = entryDurationMs(entry, now)

  return (
    <li className="entry-row">
      <div className="entry-times">
        <time dateTime={entry.start}>{formatClock(start)}</time>
        <span aria-hidden="true"> – </span>
        {end ? (
          <time dateTime={entry.end ?? ''}>{formatClock(end)}</time>
        ) : (
          <span className="badge badge-running">running</span>
        )}
      </div>
      <div className="entry-duration" data-testid={`duration-${entry.id}`}>
        {formatDuration(duration)}
      </div>
      {entry.note && <p className="entry-note">{entry.note}</p>}
      <a className="entry-edit" href={`#/entries/${entry.id}`}>
        Edit<span className="visually-hidden"> entry starting {formatClock(start)}</span>
      </a>
    </li>
  )
}

function heading(key: string): string {
  const { start } = localDayBounds(key)
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(start)
}
