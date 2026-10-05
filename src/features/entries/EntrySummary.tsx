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
 * The period control and the per-client summary (items 22 and 25).
 *
 * The client filter used to live here too, as a dropdown. Item 25 moved it to the timer
 * card, where the clients already are — so what remains is only what is genuinely about the
 * entries rather than about which client is being looked at.
 */

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
