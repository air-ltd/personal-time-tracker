import { useMemo } from 'react'
import { useEntries } from '../entries/useEntries'
import { useTaxonomy } from '../taxonomy/useTaxonomy'
import { EntryList } from '../entries/EntryList'
import { EntrySummary, PeriodControl, ClientFilter } from '../entries/EntrySummary'
import { useTimer } from '../timer/useTimer'
import type { Period } from '../../domain/entries/summary'
import { useState } from 'react'

/**
 * The entries view (items 21 and 22 of `SPECS/todo.md`).
 *
 * Item 21: "ability to select a client and have entries filtered by that client (this does
 * not necessarily start a timer). If a timer is active for a client the entries should be
 * filtered for that client."
 *
 * That second sentence is the interesting one. A timer is an assertion that the user is
 * working for that client *right now*, so while one runs, showing every client's entries
 * invites attributing this hour to the wrong row. So a running timer wins over the
 * selection — and it wins visibly, because the control shows which client is filtering and
 * why, rather than the list silently changing under someone who chose something else.
 *
 * Starting a timer is deliberately not what selects a client. The control filters; the
 * timer button records. Conflating them would mean choosing a client to look at something
 * also started a clock, and there is no way back from that except stopping it.
 */
export function EntriesView({ now }: { now: Date }) {
  const { entries, loading } = useEntries()
  const { projects, clients } = useTaxonomy()
  const { running } = useTimer()

  const [selected, setSelected] = useState<string | null>(null)
  /**
   * Defaults to "all", so the home screen still shows the day-grouped list 0004 L1–L2
   * asks for. Daily and weekly are opt-in summaries; making either the default would
   * replace the entry list with totals the user did not ask for, and would hide the
   * empty state (0007 FB3) behind a summary that reads as "no data" instead of "no work".
   */
  const [period, setPeriod] = useState<Period>('all')

  const projectById = useMemo(() => new Map(projects.map((row) => [row.id, row])), [projects])

  /**
   * The client the running timer belongs to, or null.
   *
   * Resolved through the project so it agrees with the timer panel's own rule for which
   * line is active. A timer with no project — uncategorised, or a client whose project is
   * missing — belongs to no client and filters nothing.
   */
  const runningClientId = useMemo(() => {
    if (running?.projectId == null) return null
    return projectById.get(running.projectId)?.clientId ?? null
  }, [running, projectById])

  const filteredByTimer = runningClientId !== null
  const clientId = filteredByTimer ? runningClientId : selected

  const visible = useMemo(
    () =>
      entries.filter((entry) => {
        if (clientId === null) return true
        if (entry.projectId === null) return false
        return projectById.get(entry.projectId)?.clientId === clientId
      }),
    [entries, clientId, projectById],
  )

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Entries</h2>
        <a className="button" href="#/entries/new">
          Add entry
        </a>
      </div>

      <div className="entries-controls">
        <ClientFilter
          clients={clients}
          selected={clientId}
          lockedBy={filteredByTimer ? runningClientId : null}
          onSelect={setSelected}
        />
        <PeriodControl value={period} onChange={setPeriod} />
      </div>

      {/*
        Nothing recorded at all is stated once, whatever the period: an empty summary reads
        as "nothing in this period", which is a different and more alarming claim than
        "no work recorded yet" (0007 FB3).
      */}
      {entries.length === 0 && !loading ? (
        <p className="hint" data-testid="empty-state">
          No entries yet. Start the timer above, or add one by hand.
        </p>
      ) : period === 'all' ? (
        /*
         * All-entries keeps the list rather than summarising: a total for everything is the
         * same number the list already ends with, and the list is what you act on.
         */
        <EntryList now={now} entries={visible} />
      ) : (
        <EntrySummary
          now={now}
          entries={visible}
          projects={projects}
          clients={clients}
          period={period}
        />
      )}

      {loading && <p className="hint">Loading…</p>}
    </div>
  )
}
