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

const DEFAULT_CURRENCY_KEY = 'app-default-currency'

/**
 * The user's app-wide default currency, or null when they have not chosen one.
 *
 * Null is distinct from the fallback: null means "inherit", and the fallback is only
 * applied at the very end of the resolution chain, once project and client have both
 * declined. Collapsing them would make it impossible to tell an unset default from one
 * deliberately set to the fallback value.
 */
export async function readDefaultCurrency(): Promise<string | null> {
  const record = await getDb().meta.get(DEFAULT_CURRENCY_KEY)
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
    await getDb().meta.delete(DEFAULT_CURRENCY_KEY)
    bumpRevision()
    return
  }
  const upper = code.trim().toUpperCase()
  await getDb().meta.put({ key: DEFAULT_CURRENCY_KEY, value: upper })
  bumpRevision()
}
