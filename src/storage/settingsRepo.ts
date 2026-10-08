import { getDb } from './db'
import { bumpRevision } from './events'
import { CURRENCY_CODES } from '../domain/taxonomy/currencies'

/**
 * App-wide preferences (0003 CU4).
 *
 * Stored in `meta` rather than `localStorage`: 0011 R5 allows localStorage only for
 * non-sensitive UI state, and the theme is the sole permitted key. A billing currency
 * is user data, so it belongs in IndexedDB alongside everything else.
 *
 * **These settings do not sync.** `meta` is deliberately excluded from the snapshot
 * bridge — it holds sync bookkeeping (`LAST_REV_KEY`, `LAST_SYNC_KEY`), which is
 * per-device by nature, and 0008 S2 keeps credentials and device state out of a backup
 * file. The cost is that a default currency set on one device does not follow the user
 * to another.
 *
 * That is a real limitation rather than a settled answer. A default that differs per
 * device means an uncategorised entry shows a different currency depending on which
 * machine it was viewed on, which is confusing in exactly the multi-device case this
 * app is built for. The fix is a synced singleton record, and it is not a small one:
 * two devices setting different defaults at the same time is a genuine conflict with
 * no obvious merge rule, so it deserves its own decision rather than being folded into
 * a phase about projects and clients. Recorded in `todo.md`.
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
 * Two settings are deliberately absent. The theme stays in localStorage because 0002 TH4
 * needs it readable before first paint, which IndexedDB cannot do. The Dropbox app key is
 * chosen by host, so syncing it would let a local build inherit the deployed app's identity.
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
