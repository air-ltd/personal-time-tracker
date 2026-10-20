/**
 * Which Dropbox account this device's data belongs to.
 *
 * The problem this exists for: signing out deliberately leaves the local data
 * (0012 AU7), so the data outlives the connection. Connect a *different* account
 * afterwards, and the engine's first run finds an empty remote and publishes
 * everything into it — the previous account's client names, notes and hours,
 * handed to a different readership without a word of warning.
 *
 * The account id is the answer Dropbox already gives (`account_id` on the token
 * response) and it was being stored and never compared to anything. This is where
 * the comparison happens.
 *
 * **Device-local, and deliberately not synced.** It is a fact about *this device's*
 * data, not about the data itself — and a binding that travelled would be exactly
 * the wrong thing to copy to another device, which may hold different work.
 */
import { getDb } from './db'

const BOUND_ACCOUNT_KEY = 'sync:boundAccountId'

/**
 * The account this device's data was last published to, or null.
 *
 * Null means "never published", which is a different answer from "published to an
 * account whose id we could not read". The second is treated as unknown rather
 * than as a mismatch, because refusing to sync against an account we simply
 * cannot identify would be a worse failure than the one being prevented.
 */
export async function readBoundAccountId(): Promise<string | null> {
  const record = await getDb().meta.get(BOUND_ACCOUNT_KEY)
  return typeof record?.value === 'string' ? record.value : null
}

/**
 * Record the account this device's data belongs to.
 *
 * Called after a successful publish, and when the user explicitly says to share
 * the data with a different account.
 */
export async function writeBoundAccountId(accountId: string): Promise<void> {
  await getDb().meta.put({ key: BOUND_ACCOUNT_KEY, value: accountId })
}

/** Forget the binding — used when the local data is erased or replaced. */
export async function clearBoundAccountId(): Promise<void> {
  await getDb().meta.delete(BOUND_ACCOUNT_KEY)
}
