import { groupEntriesByDay } from '../../domain/entries/group'
import { formatClock, formatDuration, entryDurationMs } from '../../domain/time/duration'
import { localDayBounds } from '../../domain/time/days'
import type { TimeEntry } from '../../domain/entries/types'
import { useEntries } from './useEntries'
import { useTaxonomy } from '../taxonomy/useTaxonomy'
import { EditIcon } from '../../app/Icons'
import type { Client, Project, Tag } from '../../domain/taxonomy/types'

/**
 * Entry list, grouped by local day with per-day subtotals (0004 L1–L2).
 *
 * The subtotal is the sum of the rows beneath it, so the two can never disagree
 * (0006 RP2). Overlapping entries are both counted (0004 O2): a day reading more
 * than 24 hours is a data problem the user should see.
 */
export function EntryList({
  now,
  /**
   * Pre-filtered entries, when a caller has already decided which ones to show.
   *
   * Optional so the plain case stays a one-prop component. Item 21 filters by client, and
   * filtering here as well would mean two places choosing what is shown — which is how a
   * list and the summary above it come to disagree.
   */
  entries: provided,
}: {
  now: Date
  entries?: readonly TimeEntry[] | undefined
}) {
  const stored = useEntries()
  const entries = provided ?? stored.entries
  const loading = provided === undefined && stored.loading
  const { projects, clients, tags } = useTaxonomy()
  const groups = groupEntriesByDay(entries, now)

  // Resolved once here rather than in each row: a row that called `useTaxonomy` would
  // subscribe to the same store N times, and `useSyncExternalStore` re-reads on every
  // notification — so a long day would re-read the whole taxonomy per row.
  const projectById = new Map(projects.map((row) => [row.id, row]))
  const clientById = new Map(clients.map((row) => [row.id, row]))
  const tagById = new Map(tags.map((row) => [row.id, row]))

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
              <EntryRow
                key={entry.id}
                entry={entry}
                now={now}
                project={
                  entry.projectId === null ? null : (projectById.get(entry.projectId) ?? null)
                }
                client={
                  entry.projectId === null
                    ? null
                    : (clientById.get(projectById.get(entry.projectId)?.clientId ?? '') ?? null)
                }
                tags={entry.tagIds
                  .map((id) => tagById.get(id))
                  .filter((tag): tag is Tag => tag !== undefined)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function EntryRow({
  entry,
  now,
  project,
  client,
  tags,
}: {
  entry: TimeEntry
  now: Date
  project: Project | null
  client: Client | null
  tags: Tag[]
}) {
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
      {/*
        One wrapper for everything textual (item 27).

        These were separate children of the grid, so with the pencil pulled into a column
        of its own they landed in columns 1 and 2 of a second row — the tags and the note
        appearing to the left of the project they belong to. A grid wants a fixed number of
        columns; the flexible part belongs inside one of them.
      */}
      <div className="entry-content">
        <div className="entry-taxonomy">
          {project === null ? (
            // U1/U2: uncategorised is named rather than shown as a blank, so an entry that
            // lost its project — or never had one — reads as a state rather than as missing
            // information.
            <span className="entry-project entry-uncategorised">Uncategorised</span>
          ) : (
            <>
              {/* N2: the project name is always text, and the client is named beside it.
                  The swatch repeats information already in words, so colour is never the
                  only carrier of meaning. */}
              <span className="entry-project">
                <span
                  className="tag-swatch"
                  style={{ background: project.colour }}
                  aria-hidden="true"
                />
                {project.name}
                {project.archived && <span className="badge badge-archived">archived</span>}
                {client !== null && <span className="entry-client"> · {client.name}</span>}
              </span>
            </>
          )}
          {entry.billable && (
            <span className="badge badge-billable" data-testid={`billable-${entry.id}`}>
              Billable
            </span>
          )}
        </div>

        {tags.length > 0 && (
          <ul className="entry-tags" data-testid={`tags-${entry.id}`}>
            {tags.map((tag) => (
              <li key={tag.id} className="chip">
                <span
                  className="tag-swatch"
                  style={{ background: tag.colour }}
                  aria-hidden="true"
                />
                {tag.name}
              </li>
            ))}
          </ul>
        )}

        {/*
        On one line with the times and duration (item 20): a row per entry with its edit
        control on a line of its own made a day of modest work taller than the screen. The
        note still gets its own line when there is one, because a long note squeezed into
        a single row is unreadable — it is the length, not the fact of a note, that earns
        the space.
      */}
        {entry.note && <p className="entry-note">{entry.note}</p>}
      </div>

      {/* Item 27: the pencil shares the entry's first line, pinned to its right edge. */}
      <a
        className="entry-edit"
        href={`#/entries/${entry.id}`}
        aria-label={`Edit entry starting ${formatClock(start)}`}
        title="Edit"
      >
        <EditIcon />
      </a>
    </li>
  )
}

/**
 * Day heading, or the raw key when it cannot be parsed.
 *
 * `localDayBounds` throws on a malformed key, and a key comes from a stored timestamp —
 * so one corrupt `start` would throw during render and take down the whole list, hiding
 * every other entry with it. Showing the key is unhelpful but honest, and keeps the rest
 * of the day readable.
 */
function heading(key: string): string {
  try {
    const { start } = localDayBounds(key)
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(start)
  } catch {
    return key
  }
}
