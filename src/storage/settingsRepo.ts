import { getDb } from './db'
import { bumpRevision } from './events'
import { CURRENCY_CODES } from '../domain/taxonomy/currencies'
import type { WeekStart } from '../domain/time/days'

/**
 * App-wide preferences (0003 CU4).
 *
 * Stored in IndexedDB rather than `localStorage`: 0011 R5 allows localStorage only for
 * non-sensitive UI state, and the theme is the sole permitted key. A billing currency
 * is user data, so it belongs in IndexedDB alongside everything else.
 *
 * **These settings do sync.** They live in their own `settings` table rather than in
 * `meta`, so the split between "the user's preferences" and "this device's sync
 * bookkeeping" is structural rather than a filter someone has to remember (SPECS/todo.md
 * item 46). The theme stays in `localStorage` — 0002 TH4 needs it before first paint,
 * which IndexedDB cannot do — and the Dropbox app key stays device-local, because it is
 * chosen by host.
 */

/*
 * Settings, as rows in the `settings` table rather than `meta` (SPECS/todo.md item 46).
 *
 * `meta` mixes this device's sync bookkeeping with the user's preferences, and only the
 * second kind should travel. Sharing one table would mean every sync deciding which half to
 * send; separating them makes it structural instead — `snapshotRepo` includes `settings` and
 * still leaves `meta` out, so a credential or a revision number cannot leak into a sync
 * payload or a backup file by being forgotten (0012 AU6, 0008 S2).
 *
 * Every write stamps `updatedAt`, which is what lets these merge through the existing
 * union-by-id, last-write-wins path: a setting is one value under a stable key, so
 * "whichever device changed it most recently wins" is both the rule and the correct one.
 *
 * A setting that has never been chosen is *absent*, not stored-as-default (0003 SET2).
 * Absent and default are different answers, and collapsing them would mean a later
 * change of default silently rewrote a value the user had explicitly chosen.
 */
/**
 * Writes one setting, stamping the merge identity.
 *
 * `updatedAt` is what the sync merge orders by, and `deletedAt` is what makes the row the
 * same shape as every other mergeable table — so a setting needs no merge rule of its own.
 */
async function putSetting(id: string, value: unknown): Promise<void> {
  await getDb().settings.put({
    id,
    value,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  })
}

const DEFAULT_CURRENCY_KEY = 'app-default-currency'
const VISIBLE_CURRENCIES_KEY = 'visible-currencies'
const ENTRY_PERIOD_KEY = 'entry-period'

/**
 * The user's app-wide default currency, or null when they have not chosen one.
 *
 * Null is distinct from the fallback: null means "inherit", and the fallback is only
 * applied at the very end of the resolution chain, once project and client have both
 * declined. Collapsing them would make it impossible to tell an unset default from one
 * deliberately set to the fallback value.
 */
export async function readDefaultCurrency(): Promise<string | null> {
  const record = await getDb().settings.get(DEFAULT_CURRENCY_KEY)
  const value = record?.value
  if (typeof value !== 'string') return null
  const upper = value.trim().toUpperCase()
  // A code the runtime no longer offers is dropped rather than stored. It can still be
  // *displayed* — currency formatting copes with unknown codes — but offering it as a
  // choice the user cannot re-select would be a trap.
  return CURRENCY_CODES.includes(upper) ? upper : null
}

/** Set or clear the default. An empty value clears it, which is how "inherit" is set. */
export async function writeDefaultCurrency(code: string | null): Promise<void> {
  if (code === null || code.trim() === '') {
    await getDb().settings.delete(DEFAULT_CURRENCY_KEY)
    bumpRevision()
    return
  }
  const upper = code.trim().toUpperCase()
  await putSetting(DEFAULT_CURRENCY_KEY, upper)
  bumpRevision()
}

/**
 * The currencies offered in pickers, or null when the user has not narrowed them.
 *
 * The ISO 4217 list is over 180 entries, almost all of which are currencies this user
 * will never invoice in. Item 13 of `SPECS/todo.md` asks to be able to keep the
 * relevant ones and hide the rest.
 *
 * Null means "no narrowing chosen". An empty list is normalised to it rather than
 * reported as itself, because the two are indistinguishable to a user — "I hid the
 * ones I don't use" and "I hid all of them" both describe leaving nothing ticked, and
 * only one of them is a thing anybody meant. Treating `[]` as its own meaning would
 * leave every picker in the app offering the single currency each record already had,
 * with no way to say so. Nothing writes `[]` any more; normalising on read means a
 * value written by an older build, or by hand, cannot become a trap.
 *
 * A stored code the runtime no longer offers is dropped on read, for the same reason as
 * the default currency above — it can still be displayed, but offering a choice the
 * user cannot re-select is a trap.
 */
export async function readVisibleCurrencies(): Promise<string[] | null> {
  const record = await getDb().settings.get(VISIBLE_CURRENCIES_KEY)
  const value = record?.value
  if (!Array.isArray(value)) return null
  const codes = value
    .filter((code): code is string => typeof code === 'string')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => CURRENCY_CODES.includes(code))
  // De-duplicated, because the same code can arrive twice from a merge of two lists.
  const unique = [...new Set(codes)]
  return unique.length === 0 ? null : unique
}

/** Narrow the offered currencies, or pass null to offer all of them again. */
export async function writeVisibleCurrencies(codes: readonly string[] | null): Promise<void> {
  if (codes === null) {
    await getDb().settings.delete(VISIBLE_CURRENCIES_KEY)
    bumpRevision()
    return
  }
  await putSetting(VISIBLE_CURRENCIES_KEY, [...codes])
  bumpRevision()
}

/**
 * The entries period the user last chose (item 28).
 *
 * In IndexedDB rather than `localStorage`, which 0011 R5 reserves for the theme. Slightly
 * awkward for a display preference — the control shows "all" for a frame before the stored
 * value arrives — but it keeps the app to one localStorage key, and the same trade-off was
 * already made for the visible currencies.
 *
 * Read as "all" when nothing is stored, or when the stored value is not one of the three
 * periods: a corrupted preference should not be able to leave the list in a state nothing
 * can get out of.
 */
export async function readEntryPeriod(): Promise<'day' | 'week' | 'all'> {
  const record = await getDb().settings.get(ENTRY_PERIOD_KEY)
  const value = record?.value
  return value === 'day' || value === 'week' || value === 'all' ? value : 'all'
}

/** Remember the chosen period. */
export async function writeEntryPeriod(period: 'day' | 'week' | 'all'): Promise<void> {
  await putSetting(ENTRY_PERIOD_KEY, period)
  bumpRevision()
}

const WEEK_START_KEY = 'week-start'

/**
 * The day the week starts on (0006 DR3).
 *
 * Monday by default, because most of the world starts the working week on Monday and
 * guessing Sunday would be wrong for most of them. It is a setting rather than a
 * constant because the report's week boundaries depend on it (0006 DT8, 0013 K3), and
 * a week that starts on the wrong day puts every weekly figure a day out.
 *
 * Read as `monday` when nothing is stored, or when the stored value is not one of the
 * two days: a corrupted preference must not leave the week boundaries undefined.
 */
export async function readWeekStart(): Promise<WeekStart> {
  const record = await getDb().settings.get(WEEK_START_KEY)
  const value = record?.value
  return value === 'sunday' ? 'sunday' : 'monday'
}

/** Remember the day the week starts on. */
export async function writeWeekStart(weekStart: WeekStart): Promise<void> {
  await putSetting(WEEK_START_KEY, weekStart)
  bumpRevision()
}

const ROUNDING_INCREMENT_KEY = 'billable-rounding-increment'

/** The default billable rounding increment, in minutes (0006 RD2). */
export const DEFAULT_ROUNDING_INCREMENT_MINUTES = 15

/**
 * The billable rounding increment, in minutes (0006 RD2, RD2.1).
 *
 * Fifteen minutes is the conventional billing increment, and it is coarse enough that
 * an invoice can be checked by hand.
 *
 * The value is stored rather than hard-coded because 0006 RD2.1 requires the stored
 * value to exist *before* a control for it is added, so that adding the control is a
 * UI change and not a migration. It ships in the same schema increment as the contract
 * periods, which is the last moment a migration can be avoided for free.
 *
 * Read as the default when nothing is stored, or when the stored value is not a
 * positive whole number of minutes: a corrupted preference must not produce a
 * rounding increment of zero, which would round every billable duration to nothing.
 */
export async function readRoundingIncrementMinutes(): Promise<number> {
  const record = await getDb().settings.get(ROUNDING_INCREMENT_KEY)
  const value = record?.value
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return DEFAULT_ROUNDING_INCREMENT_MINUTES
  }
  return value
}

/**
 * Remember the billable rounding increment.
 *
 * Changing it MUST NOT alter anything already stored (0006 RD2.2): the increment is
 * applied at read time, so entries keep their own durations and only the figures
 * computed from them change.
 */
export async function writeRoundingIncrementMinutes(minutes: number): Promise<void> {
  await putSetting(ROUNDING_INCREMENT_KEY, minutes)
  bumpRevision()
}
