import { useEffect, useMemo, useState } from 'react'
import { ContractEditor } from './ContractEditor'
import { useContracts } from './useContracts'
import { useRevision } from '../../storage/useRevision'
import { readWeekStart } from '../../storage/settingsRepo'
import { dayKey, localWeekBounds } from '../../domain/time/days'
import type { Client } from '../../domain/taxonomy/types'

/**
 * Expected hours per client, in settings (0013 CR1, 0003 CT1–CT9).
 *
 * A client-scoped budget is an input, so it belongs in settings rather than on a
 * report screen: a report that could be edited would be a report whose figures change
 * while they are being read, and every figure here is computed at read time
 * (0013 CP1).
 *
 * The panel is deliberately one line per client until asked otherwise. The question a
 * user has is "which of my clients have I set a budget for", and a list of open forms
 * answers a different question they did not ask.
 */
export interface ContractSettingsProps {
  clients: readonly Client[]
  now: Date
}

export function ContractSettings({ clients, now }: ContractSettingsProps) {
  const { periods, loading, error } = useContracts()
  const revision = useRevision()
  const [editing, setEditing] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [weekStart, setWeekStart] = useState<'monday' | 'sunday'>('monday')

  // The week start decides where a new contract begins, so it is read here rather
  // than assumed. Re-read when the revision changes, because the setting is editable.
  useEffect(() => {
    let cancelled = false
    void readWeekStart()
      .then((start) => {
        if (!cancelled) setWeekStart(start)
      })
      .catch(() => {
        // A failed read leaves the default in place, which is the same answer a
        // missing setting gives.
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  const defaultEffectiveFrom = useMemo(() => {
    const { start } = localWeekBounds(dayKey(now), weekStart)
    return dayKey(start)
  }, [now, weekStart])

  if (loading) return <p className="hint">Loading expected hours…</p>

  const active = clients.filter((client) => !client.archived)

  return (
    <section className="panel" aria-labelledby="contracts-heading">
      <h2 id="contracts-heading">Expected hours</h2>
      <p className="hint">
        The hours you expect to spend on each client in a week. Reports compare what was tracked
        against these, so a client with no expected hours has nothing to compare against.
      </p>

      {error !== null && (
        <div className="alert alert-error" role="alert" data-testid="contracts-load-error">
          <p>{error}</p>
        </div>
      )}
      {saveError !== null && (
        <div className="alert alert-error" role="alert" data-testid="contracts-save-error">
          <p>{saveError}</p>
          <button type="button" className="button" onClick={() => setSaveError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {active.length === 0 ? (
        <p className="hint">No clients yet. Add one and its expected hours can be set here.</p>
      ) : (
        <ul className="contract-list">
          {active.map((client) => {
            const period = periods.find(
              (row) => row.clientId === client.id && row.deletedAt === null,
            )
            const open = editing === client.id
            return (
              <li className="contract-row" key={client.id}>
                <div className="contract-summary">
                  <span className="contract-name">{client.name}</span>
                  <span className="taxonomy-meta">
                    {period === undefined
                      ? 'No expected hours set'
                      : `${(period.minutesPerWeek / 60).toFixed(2).replace(/\.00$/, '')} hours a week`}
                  </span>
                  <button
                    type="button"
                    className="button"
                    aria-expanded={open}
                    onClick={() => setEditing(open ? null : client.id)}
                  >
                    {open ? 'Close' : period === undefined ? 'Set hours' : 'Edit hours'}
                  </button>
                </div>
                {open && (
                  <ContractEditor
                    client={client}
                    period={period}
                    now={now}
                    defaultEffectiveFrom={defaultEffectiveFrom}
                    onSaved={() => {
                      setEditing(null)
                      setSaveError(null)
                    }}
                    onError={setSaveError}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
