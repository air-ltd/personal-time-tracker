import {
  PERIODS,
  PERIOD_LABELS,
  summariseEntries,
  type Period,
} from '../../domain/entries/summary'
import { formatDuration } from '../../domain/time/duration'
import type { TimeEntry } from '../../domain/entries/types'
import type { Client, Project } from '../../domain/taxonomy/types'

/**
 * The client filter and the period control (items 21 and 22).
 *
 * Split from `EntriesView` because the reasoning about which client wins — the selection
 * or the running timer — belongs there, and this file is only presentation.
 */

/**
 * Choose a client.
 *
 * A filter that is being overridden says so, and says why. Silently showing one client's
 * entries while the control claims another is the kind of thing that is only noticed once
 * a figure has been believed.
 */
export function ClientFilter({
  clients,
  selected,
  lockedBy,
  onSelect,
}: {
  clients: readonly Client[]
  selected: string | null
  /** Non-null when a running timer is forcing the filter, whatever the selection says. */
  lockedBy: string | null
  onSelect: (clientId: string | null) => void
}) {
  const id = 'entry-client-filter'
  const lockedName =
    lockedBy === null ? null : (clients.find((c) => c.id === lockedBy)?.name ?? null)

  return (
    <div className="field entries-filter">
      <label htmlFor={id}>Client</label>
      <select
        id={id}
        value={selected ?? ''}
        // Disabled rather than ignored while locked: a control that looks live and is not
        // is worse than one that visibly cannot be moved.
        disabled={lockedBy !== null}
        onChange={(event) => onSelect(event.target.value === '' ? null : event.target.value)}
        data-testid="client-filter"
      >
        <option value="">All clients</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
      {lockedName !== null && (
        <p className="hint" data-testid="client-filter-locked">
          Showing {lockedName}, because a timer is running for it.
        </p>
      )}
    </div>
  )
}

/** Daily, weekly, or all entries (item 22). */
export function PeriodControl({
  value,
  onChange,
}: {
  value: Period
  onChange: (period: Period) => void
}) {
  return (
    <fieldset className="period-control">
      <legend className="visually-hidden">Period</legend>
      {PERIODS.map((period) => (
        <span key={period} className="period-control-option">
          <input
            type="radio"
            id={`period-${period}`}
            name="entry-period"
            value={period}
            checked={value === period}
            onChange={() => onChange(period)}
          />
          <label htmlFor={`period-${period}`}>{PERIOD_LABELS[period]}</label>
        </span>
      ))}
    </fieldset>
  )
}

/** Totals per client, per day or per week (item 22). */
export function EntrySummary({
  now,
  entries,
  projects,
  clients,
  period,
}: {
  now: Date
  entries: readonly TimeEntry[]
  projects: readonly Project[]
  clients: readonly Client[]
  period: Exclude<Period, 'all'>
}) {
  const buckets = summariseEntries({ entries, projects, clients, period, clientId: null, now })

  if (buckets.length === 0) {
    return (
      <p className="hint" data-testid="summary-empty">
        Nothing recorded for this period.
      </p>
    )
  }

  return (
    <div className="entry-summary" data-testid="entry-summary">
      {buckets.map((bucket) => (
        <section key={bucket.dayKey ?? bucket.label} className="summary-bucket">
          <header className="summary-bucket-header">
            <h3>{bucket.label}</h3>
            <span className="summary-bucket-total">{formatDuration(bucket.totalMs)}</span>
          </header>
          <ul className="summary-rows">
            {bucket.rows.map((row) => (
              <li key={row.clientId ?? 'uncategorised'} className="summary-row">
                {/*
                  The swatch repeats the name beside it rather than standing in for it, so
                  colour is never the only thing distinguishing two clients (0005 N2).
                */}
                <span className="summary-row-name">
                  {row.colour !== null && (
                    <span
                      className="tag-swatch"
                      style={{ background: row.colour }}
                      aria-hidden="true"
                    />
                  )}
                  {row.clientName}
                  {row.projectNames.length > 0 && (
                    <span className="summary-row-projects">
                      {' '}
                      · {row.projectNames.join(', ')}
                    </span>
                  )}
                </span>
                <span className="summary-row-total">
                  {formatDuration(row.totalMs)}
                  <span className="visually-hidden">
                    {' '}
                    across {row.entryCount} {row.entryCount === 1 ? 'entry' : 'entries'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
