import { getDb } from './db'
import type { DropboxTokens, DropboxTokenStore } from '../sync/dropbox/DropboxProvider'

/**
 * Token storage backed by IndexedDB (0012 AU5).
 *
 * Tokens are secrets: never logged, never included in an export, never rendered in
 * full in the UI. They live in their own table so the snapshot reader can exclude
 * them structurally rather than by remembering to filter (0008 S2, 0012 AU6).
 */
const KEY = 'dropbox-tokens'

/**
 * Defensive parse.
 *
 * The stored value is untrusted input in practice: it survives schema migrations and
 * may have been written by a different build. A malformed record is treated as "not
 * connected" so the user is prompted to reconnect rather than the app failing on a
 * shape mismatch.
 */
function toTokens(value: unknown): DropboxTokens | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Partial<DropboxTokens>
  if (typeof candidate.accessToken !== 'string' || candidate.accessToken === '') return null

  return {
    accessToken: candidate.accessToken,
    ...(typeof candidate.expiresAt === 'number' ? { expiresAt: candidate.expiresAt } : {}),
    ...(typeof candidate.accountId === 'string' ? { accountId: candidate.accountId } : {}),
  }
}

export const indexedDbTokenStore: DropboxTokenStore = {
  read(): Promise<DropboxTokens | null> {
    return getDb()
      .secrets.get(KEY)
      .then((record) => toTokens(record?.value))
  },

  write(tokens: DropboxTokens): Promise<void> {
    // Dexie's put resolves with the key; discard it to match the void contract.
    return getDb()
      .secrets.put({ key: KEY, value: tokens })
      .then(() => undefined)
  },

  clear(): Promise<void> {
    return getDb()
      .secrets.delete(KEY)
      .then(() => undefined)
  },
}
