import { useMemo } from 'react'
import { useContracts } from './useContracts'
import { expectedMinutesByWeek } from '../../domain/capacity/expected'
import {
  billableUtilisation,
  formatUtilisation,
  utilisation,
} from '../../domain/capacity/utilisation'
import { formatMinutes } from '../../domain/time/duration'
import type { ReportEntry } from '../../domain/reports/report'
import type { DateRange } from '../../domain/reports/ranges'
import type { Client } from '../../domain/taxonomy/types'

/**
 * Expected against actual (0013 CR2, CR3).
 *
 * The comparison the whole capacity feature exists for: of the hours expected on a
 * client, how many were delivered.
 *
 * Every figure is computed at read time from the entries and the contract (0013 CP1),
 * so an edit to either is reflected immediately — and a contract edit rewrites history,
 * which is why the panel says so rather than hiding it (0013 K7).
 *
 * The range and the prepared entries are passed in rather than read here, so that this
 * panel and the entry-only reports below it agree about what an entry's duration is.
 * Two reports computing it separately is how a breakdown stops reconciling with its
 * total (0006 RP2).
 */
export interface CapacityReportProps {
  range: DateRange
  prepared: readonly ReportEntry[]
  /** The clients, so a row can be named rather than identified. */
  clients: readonly Client[]
}

export function CapacityReport({ range, prepared, clients }: CapacityReportProps) {
  const nameOf = useMemo(() => {
    const byId = new Map(clients.map((client) => [client.id, client.name]))
    return (id: string) => byId.get(id) ?? id
  }, [clients])

  const { periods, loading } = useContracts()

  const rows = useMemo(() => {
    /*
     * Every client that has either a contract or some time tracked.
     *
     * The union, not just the clients with entries. A client you expect to spend
     * twenty hours a week on, and have spent nothing on, is exactly the row the
     * report exists to show — and leaving it out makes "no time tracked" look
     * identical to "no expectation set".
     */
    const clientIds = new Set<string>()
    for (const item of prepared) {
      if (item.clientId !== null) clientIds.add(item.clientId)
    }
    for (const period of periods) {
      if (period.deletedAt === null) clientIds.add(period.clientId)
    }

    return [...clientIds].map((clientId) => {
      const clientEntries = prepared.filter((item) => item.clientId === clientId)
      const workedMs = clientEntries.reduce((total, item) => total + (item.durationMs ?? 0), 0)
      const billableMs = clientEntries.reduce(
        (total, item) => total + (item.billableMs ?? 0),
        0,
      )
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
      const worked = {
        minutes: Math.round(workedMs / 60_000),
        billableMinutes: Math.round(billableMs / 60_000),
      }
      const figure = utilisation(range.from, range.to, clientId, periods, worked)
      // 0013 CR3 asks for hour *and* billable utilisation. The billable one is a
      // different question — it is the share of the expected hours that was billable
      // — and it is the one that answers "was the billable work enough?".
      const billable = billableUtilisation(range.from, range.to, clientId, periods, worked)
      return { clientId, figure, billable }
    })
  }, [range, prepared, periods])

  const weeks = useMemo(() => {
    return [...new Set(rows.map((row) => row.clientId))].map((clientId) => ({
      clientId,
      byWeek: expectedMinutesByWeek(range.from, range.to, clientId, periods),
    }))
  }, [range, rows, periods])

  if (loading) return <p className="hint">Loading expected hours…</p>

  if (rows.length === 0) {
    return (
      <section className="panel" aria-labelledby="capacity-heading">
        <h2 id="capacity-heading">Expected against actual</h2>
        <p className="hint">
          No client has expected hours yet. Set them in Settings, and this will compare them
          against what has been tracked.
        </p>
      </section>
    )
  }

  return (
    <section className="panel" aria-labelledby="capacity-heading">
      <h2 id="capacity-heading">Expected against actual</h2>

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
            <th scope="col">Billable</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ clientId, figure, billable }) => (
            <tr key={clientId}>
              <th scope="row">{nameOf(clientId)}</th>
              <td>{figure.expected === null ? '—' : formatMinutes(figure.expected)}</td>
              <td>{formatMinutes(figure.worked)}</td>
              <td>{figure.delta === null ? '—' : formatMinutes(figure.delta)}</td>
              <td>{formatUtilisation(figure.percent)}</td>
              <td>{formatUtilisation(billable.percent)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/*
        Per week, because a contract is expressed in weeks and a month-long total hides
        which week went short (0013 CR2).
      */}
      <div className="capacity-weeks">
        {weeks.map(({ clientId, byWeek }) => (
          <div key={clientId} className="capacity-week-group">
            <h3>{nameOf(clientId)}</h3>
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

      <p className="hint">
        Expected hours are computed from the current contract, so changing a contract changes
        these figures for earlier periods too.
      </p>
    </section>
  )
}
