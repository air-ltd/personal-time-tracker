import { useEffect, useMemo, useState } from 'react'
import { CapacityReport } from '../capacity/CapacityReport'
import { EntryReports } from '../reports/EntryReports'
import { InvoiceView } from '../reports/InvoiceView'
import { resolveRange, type RangeMode, type RangePreset } from '../../domain/reports/ranges'
import { readRoundingIncrementMinutes, readWeekStart } from '../../storage/settingsRepo'
import { useRevision } from '../../storage/useRevision'
import { useEntries } from '../entries/useEntries'
import { useTaxonomy } from '../taxonomy/useTaxonomy'
import { prepareEntries, rangeEntries } from '../../domain/reports/report'
import type { ReportEntry } from '../../domain/reports/report'

/**
 * The reports screen (0006, 0013).
 *
 * One range for the whole screen, because two range pickers on one page is a way of
 * showing two figures over different periods and calling them the same thing.
 *
 * The entries are prepared once and shared: every report below agrees about what an
 * entry's duration and rate are, which is what makes a breakdown reconcile with its
 * total (0006 RP2). Preparing them per report would be faster to write and would let
 * two figures quietly disagree.
 */
export interface ReportsPageProps {
  now: Date
}

export function ReportsPage({ now }: ReportsPageProps) {
  const { entries, loading: entriesLoading } = useEntries()
  const { projects, clients, loading: taxonomyLoading } = useTaxonomy()
  const revision = useRevision()

  const [preset, setPreset] = useState<RangePreset>('this-week')
  const [invoiceClientId, setInvoiceClientId] = useState<string | null>(null)
  // The clipping/overlap choice (0006 DR5), held here rather than in the report
  // panel, because the invoice needs the same durations the breakdown used — and two
  // reports over different periods would be two answers to one question.
  const [mode, setMode] = useState<RangeMode>('clipped')
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

  const prepared = useMemo(
    () =>
      prepareEntries(entries, { projects, clients, defaultCurrency: 'USD' }, now, increment),
    [entries, projects, clients, now, increment],
  )

  /*
   * The entries in the range, with what each one contributes.
   *
   * Computed once here and shared, so the capacity report, the entry reports and the
   * invoice are all about the same period. It is also what stops one of them summing
   * every entry the client has ever had while another counts only the period — the
   * comparison then means nothing.
   */
  const ranged = useMemo(
    () => (range === null ? [] : rangeEntries(prepared, range, mode, now, increment)),
    [prepared, range, mode, now, increment],
  )

  if (entriesLoading || taxonomyLoading || !loaded) {
    return <p className="hint">Loading reports…</p>
  }

  return (
    <>
      <section className="panel" aria-labelledby="report-range-heading">
        <h2 id="report-range-heading">Reports</h2>
        <div className="field">
          <label htmlFor="report-range">Period</label>
          <select
            id="report-range"
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
        <p className="hint">
          Every figure below is for the same period, and every one is worked out from your
          entries when the page is drawn — nothing is stored and nothing goes stale.
        </p>
      </section>

      {range !== null && (
        <>
          <CapacityReport now={now} range={range} ranged={ranged} clients={clients} />
          <EntryReports ranged={ranged} mode={mode} onModeChange={setMode} />

          {/*
            The invoice, for one client at a time.

            A client is chosen rather than every client's invoice shown at once,
            because an invoice is a statement about a single client and putting three
            of them on one page invites the reader to compare them and read the
            comparison as a total.
          */}
          <section className="panel" aria-labelledby="invoice-client-heading">
            <h2 id="invoice-client-heading">Invoice</h2>
            <div className="field">
              <label htmlFor="invoice-client">Client</label>
              <select
                id="invoice-client"
                value={invoiceClientId ?? ''}
                onChange={(event) => setInvoiceClientId(event.target.value || null)}
              >
                <option value="">Choose a client…</option>
                {clients
                  .filter((client) => !client.archived)
                  .map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
              </select>
            </div>
          </section>

          <InvoiceView
            clientId={invoiceClientId}
            clientName={clients.find((client) => client.id === invoiceClientId)?.name ?? ''}
            entries={prepared}
            durations={ranged.map((entry) => entry.ms)}
            incrementMinutes={increment}
          />
        </>
      )}
    </>
  )
}

export type { ReportEntry }
