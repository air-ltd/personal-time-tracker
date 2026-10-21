import { useMemo, useState } from 'react'
import {
  createContractPeriod,
  deleteContractPeriod,
  updateContractPeriod,
} from '../../storage/contractPeriodRepo'
import { evenSplitPattern } from '../../domain/capacity/contract'
import type { ContractPeriod, DayPattern } from '../../domain/capacity/types'
import type { Client } from '../../domain/taxonomy/types'

/**
 * Setting a client's expected hours (0003 CT1–CT9, 0013 K1–K9).
 *
 * The user calls this a budget, and the spec calls it contracted hours. The form asks
 * for hours per week and the days worked, because that is what a contract is expressed
 * in, and derives the per-day pattern from them (0003 CT7).
 *
 * When the week does not divide evenly the shortcut is *refused* rather than rounded
 * (0003 CT8): 2,250 minutes over four days is 562.5, and rounding it would make the
 * pattern stop summing to the week — which is exactly the mismatch CT3 forbids. The
 * form then asks for the days individually, which is what the spec requires.
 */

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]
const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export interface ContractEditorProps {
  client: Client
  /** The client's current contract, or undefined when none is set. */
  period: ContractPeriod | undefined
  now: Date
  /**
   * The start date a new contract gets.
   *
   * The start of the current week rather than today, because a contract that begins
   * today leaves the days already gone in this week uncovered, and an uncovered day
   * makes the *whole* week's expectation unknown (0013 K5). The user would set a
   * budget and then find the report showing a dash for the very week they set it in.
   *
   * A weekly figure is a claim about the week, not about the days left in it, so
   * starting at the week's beginning is the honest reading.
   */
  defaultEffectiveFrom: string
  onSaved: () => void
  onError: (message: string) => void
}

export function ContractEditor({
  client,
  period,
  now,
  defaultEffectiveFrom,
  onSaved,
  onError,
}: ContractEditorProps) {
  const [hours, setHours] = useState(() => hoursOf(period))
  const [workingDays, setWorkingDays] = useState<number[]>(() => workingDaysOf(period))
  const [perDay, setPerDay] = useState<Record<number, string>>(() => perDayOf(period))
  const [perDayMode, setPerDayMode] = useState<boolean>(() => needsPerDay(period))
  const [effectiveFrom, setEffectiveFrom] = useState(
    () => period?.effectiveFrom ?? defaultEffectiveFrom,
  )
  const [busy, setBusy] = useState(false)

  const minutes = Math.round(hours * 60)
  const evenPattern = useMemo(
    () => evenSplitPattern(minutes, workingDays),
    [minutes, workingDays],
  )
  const uneven = evenPattern === null && workingDays.length > 0

  async function save(): Promise<void> {
    setBusy(true)
    try {
      const pattern = buildPattern()
      if (pattern === null) return

      /*
       * The start date comes from the form's own state, not from a fresh default.
       * Recomputing it here would silently discard whatever the user had set — a
       * local binding of the same name would shadow the state, and the date input
       * would have no effect at all.
       */
      if (period === undefined) {
        const created = await createContractPeriod(
          {
            clientId: client.id,
            effectiveFrom,
            effectiveTo: null,
            minutesPerWeek: pattern.reduce((total, entry) => total + entry.minutes, 0),
            workPattern: pattern,
          },
          now,
        )
        if (!created.ok) {
          onError(created.reason)
          return
        }
      } else {
        const updated = await updateContractPeriod(
          period.id,
          {
            effectiveFrom,
            effectiveTo: period.effectiveTo,
            minutesPerWeek: pattern.reduce((total, entry) => total + entry.minutes, 0),
            workPattern: pattern,
          },
          now,
        )
        if (!updated.ok) {
          onError(updated.reason)
          return
        }
      }
      onSaved()
    } catch (problem) {
      onError(problem instanceof Error ? problem.message : String(problem))
    } finally {
      setBusy(false)
    }
  }

  /**
   * The pattern to store.
   *
   * The even split when the week divides, and the per-day values when it does not.
   * Null when neither is available, which the caller turns into a message rather than
   * storing a pattern that does not sum to the week.
   */
  function buildPattern(): DayPattern[] | null {
    if (perDayMode || uneven) {
      const pattern: DayPattern[] = []
      for (let weekday = 0; weekday < 7; weekday += 1) {
        const raw = perDay[weekday] ?? '0'
        const value = Number(raw)
        if (!Number.isFinite(value) || value < 0) return null
        pattern.push({ weekday, minutes: Math.round(value * 60) })
      }
      return pattern
    }
    return evenPattern
  }

  return (
    <form
      className="taxonomy-form"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="field">
        <label htmlFor={`contract-${client.id}-from`}>Starting from</label>
        <input
          id={`contract-${client.id}-from`}
          type="date"
          value={effectiveFrom}
          onChange={(event) => setEffectiveFrom(event.target.value)}
        />
        <p className="hint">
          Hours expected before this date are not known, so a report covering them shows no
          expectation rather than zero.
        </p>
      </div>

      <div className="field">
        <label htmlFor={`contract-${client.id}-hours`}>Hours expected per week</label>
        <input
          id={`contract-${client.id}-hours`}
          type="number"
          min="0"
          step="0.25"
          value={hours}
          onChange={(event) => setHours(Number(event.target.value))}
        />
      </div>

      <fieldset className="field">
        <legend>Days worked</legend>
        <div className="contract-days">
          {WEEKDAY_NAMES.map((name, weekday) => {
            const checked = workingDays.includes(weekday)
            return (
              <label key={name} className="contract-day">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    setWorkingDays((current) =>
                      event.target.checked
                        ? [...current, weekday].sort((a, b) => a - b)
                        : current.filter((day) => day !== weekday),
                    )
                  }}
                />
                <span>{WEEKDAY_SHORT[weekday]}</span>
                <span className="visually-hidden">{name}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {/*
        The uneven case, stated rather than rounded (0003 CT8). The spec requires the
        app to either prompt for per-day overrides or explain that the split is uneven;
        prompting is the more useful of the two, so that is what happens.
      */}
      {uneven && (
        <>
          <p className="alert alert-warning" role="status">
            {hours} hours does not divide evenly across {workingDays.length} days. Enter the
            hours for each day instead.
          </p>
          <div className="contract-per-day">
            {workingDays.map((weekday) => (
              <div className="field" key={weekday}>
                <label htmlFor={`contract-${client.id}-day-${weekday}`}>
                  {WEEKDAY_NAMES[weekday]} hours
                </label>
                <input
                  id={`contract-${client.id}-day-${weekday}`}
                  type="number"
                  min="0"
                  step="0.25"
                  value={perDay[weekday] ?? ''}
                  onChange={(event) => {
                    setPerDay((current) => ({ ...current, [weekday]: event.target.value }))
                    setPerDayMode(true)
                  }}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {perDayMode && !uneven && (
        <div className="contract-per-day">
          {workingDays.map((weekday) => (
            <div className="field" key={weekday}>
              <label htmlFor={`contract-${client.id}-day-${weekday}`}>
                {WEEKDAY_NAMES[weekday]} hours
              </label>
              <input
                id={`contract-${client.id}-day-${weekday}`}
                type="number"
                min="0"
                step="0.25"
                value={perDay[weekday] ?? ''}
                onChange={(event) => {
                  setPerDay((current) => ({ ...current, [weekday]: event.target.value }))
                }}
              />
            </div>
          ))}
        </div>
      )}

      <div className="taxonomy-actions">
        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Saving…' : 'Save expected hours'}
        </button>
        {period !== undefined && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void deleteContractPeriod(period.id, now)
                .then(onSaved)
                .catch((problem: unknown) =>
                  onError(problem instanceof Error ? problem.message : String(problem)),
                )
                .finally(() => setBusy(false))
            }}
          >
            Remove
          </button>
        )}
      </div>
    </form>
  )
}

function hoursOf(period: ContractPeriod | undefined): number {
  if (period === undefined) return 0
  return period.minutesPerWeek / 60
}

function workingDaysOf(period: ContractPeriod | undefined): number[] {
  if (period === undefined) return [0, 1, 2, 3, 4]
  return period.workPattern.filter((entry) => entry.minutes > 0).map((entry) => entry.weekday)
}

function perDayOf(period: ContractPeriod | undefined): Record<number, string> {
  const values: Record<number, string> = {}
  if (period === undefined) return values
  for (const entry of period.workPattern) {
    values[entry.weekday] = String(entry.minutes / 60)
  }
  return values
}

/** Whether a stored pattern has to be shown day by day rather than as an even split. */
function needsPerDay(period: ContractPeriod | undefined): boolean {
  if (period === undefined) return false
  const days = workingDaysOf(period)
  if (days.length === 0) return false
  return evenSplitPattern(period.minutesPerWeek, days) === null
}
