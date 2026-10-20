import { useEffect, useMemo, useState } from 'react'
import { useContracts } from './useContracts'
import { useEntries } from '../entries/useEntries'
import { useTaxonomy } from '../taxonomy/useTaxonomy'
import { expectedMinutesByWeek } from '../../domain/capacity/expected'
import { formatUtilisation, utilisation } from '../../domain/capacity/utilisation'
import { resolveRange, type RangePreset } from '../../domain/reports/ranges'
import { prepareEntries } from '../../domain/reports/report'
import { readRoundingIncrementMinutes, readWeekStart } from '../../storage/settingsRepo'
import { useRevision } from '../../storage/useRevision'

/**
 * Expected against actual (0013 CR2, CR3).
 *
 * The comparison the whole capacity feature exists for: of the hours expected on a
 * client, how many were delivered.
 *
 * Every figure is computed at read time from the entries and the contract (0013 CP1),
 * so an edit to either is reflected immediately — and a contract edit rewrites history,
 * which is why the panel says so rather than hiding it (0013 K7).
 */
export interface CapacityReportProps {
  now: Date
}

export function CapacityReport({ now }: CapacityReportProps) {
  const { periods, loading: contractsLoading } = useContracts()
  const { entries, loading: entriesLoading } = useEntries()
  const { projects, clients, loading: taxonomyLoading } = useTaxonomy()
  const revision = useRevision()

  const [preset, setPreset] = useState<RangePreset>('this-week')
  const [weekStart, setWeekStart] = useState<'monday' | 'sunday'>('monday')
  const [increment, setIncrement] = useState(15)
  const [loaded, setLoaded] = useState(false)

  // The settings are read once and re-read when the revision changes, rather than
  // being read on every render: a report that re-reads IndexedDB while the user is
  // reading it is a report that flickers.
  useEffect(() => {
    let cancelled = false
    void Promise.all([readWeekStart(), readRoundingIncrementMinutes()])
      .then(([start, minutes]) => {
        if (cancelled) return
        setWeekStart(start)
        setIncrement(minutes)
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  const range = useMemo(() => {
    const resolved = resolveRange(preset, now, weekStart)
    // `all-time` has no end, and this report is over a bounded period. It is not
    // offered as a preset here, so this is a guard rather than a branch.
    if (resolved === null || resolved.to === null) return null
    return { from: resolved.from, to: resolved.to }
  }, [preset, now, weekStart])

  const rows = useMemo(() => {
    if (range === null) return []
    const active = clients.filter((client) => !client.archived)
    const prepared = prepareEntries(
      entries,
      { projects, clients, defaultCurrency: 'USD' },
      now,
      increment,
    )

    return active.map((client) => {
      const clientEntries = prepared.filter((item) => item.clientId === client.id)
      const workedMs = clientEntries.reduce((total, item) => total + (item.durationMs ?? 0), 0)
      const billableMs = clientEntries.reduce(
        (total, item) => total + (item.billableMs ?? 0),
        0,
      )
      const figure = utilisation(range.from, range.to, client.id, periods, {
        /*
         * Converted to minutes, because that is the unit the capacity domain works in:
         * `expectedMinutes` returns minutes and the utilisation ratio divides one by the
         * other. Passing milliseconds would have produced a figure thousands of times too
         * large, and it would still have looked like a plausible number.
         *
         * The billable figure is the sum of the *rounded* durations, so it is the same
         * number an invoice line would show rather than a second, differently-rounded
         * version of the hours worked (0006 RD3).
         */
        minutes: Math.round(workedMs / 60_000),
        billableMinutes: Math.round(billableMs / 60_000),
      })
      return { client, figure }
    })
  }, [range, clients, entries, projects, periods, now, increment])

  const weeks = useMemo(() => {
    if (range === null) return []
    const active = clients.filter((client) => !client.archived)
    return active.map((client) => ({
      client,
      byWeek: expectedMinutesByWeek(range.from, range.to, client.id, periods, weekStart),
    }))
  }, [range, clients, periods, weekStart])

  if (contractsLoading || entriesLoading || taxonomyLoading || !loaded) {
    return <p className="hint">Loading expected hours…</p>
  }

  return (
    <section className="panel" aria-labelledby="capacity-heading">
      <h2 id="capacity-heading">Expected against actual</h2>

      <div className="field">
        <label htmlFor="capacity-range">Period</label>
        <select
          id="capacity-range"
          value={preset}
          onChange={(event) => setPreset(event.target.value as RangePreset)}
        >
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="this-week">This week</option>
          <option value="last-week">Last week</option>
          <option value="this-month">This month</option>
          <option value="last-month">Last month</option>
          <option value="last-30-days">Last 30 days</option>
          <option value="last-90-days">Last 90 days</option>
        </select>
      </div>

      {rows.length === 0 ? (
        <p className="hint">No clients yet. Add one and its expected hours can be set.</p>
      ) : (
        <table className="capacity-table">
          <caption className="visually-hidden">
            Expected hours against tracked hours, per client
          </caption>
          <thead>
            <tr>
              <th scope="col">Client</th>
              <th scope="col">Expected</th>
              <th scope="col">Tracked</th>
              <th scope="col">Difference</th>
              <th scope="col">Utilisation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ client, figure }) => (
              <tr key={client.id}>
                <th scope="row">{client.name}</th>
                <td>{figure.expected === null ? '—' : formatMinutes(figure.expected)}</td>
                <td>{formatMinutes(figure.worked)}</td>
                <td>{figure.delta === null ? '—' : formatMinutes(figure.delta)}</td>
                <td>{formatUtilisation(figure.percent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/*
        Per week, because a contract is expressed in weeks and a month-long total hides
        which week went short (0013 CR2).
      */}
      {weeks.length > 0 && (
        <div className="capacity-weeks">
          {weeks.map(({ client, byWeek }) => (
            <div key={client.id} className="capacity-week-group">
              <h3>{client.name}</h3>
              {byWeek.size === 0 ? (
                <p className="hint">Nothing in this period.</p>
              ) : (
                <ul className="capacity-week-list">
                  {[...byWeek.entries()].map(([week, value]) => (
                    <li key={week}>
                      <span className="capacity-week">{week}</span>
                      <span>{value.minutes === null ? '—' : formatMinutes(value.minutes)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="hint">
        Expected hours are computed from the current contract, so changing a contract changes
        these figures for earlier periods too.
      </p>
    </section>
  )
}

/** Minutes as hours and minutes, for the table. */
function formatMinutes(minutes: number): string {
  const sign = minutes < 0 ? '-' : ''
  const absolute = Math.abs(minutes)
  const hours = Math.floor(absolute / 60)
  const rest = absolute % 60
  if (hours === 0) return `${sign}${rest}m`
  if (rest === 0) return `${sign}${hours}h`
  return `${sign}${hours}h ${rest}m`
}
