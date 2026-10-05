import { getDb } from './db'

/**
 * Token storage backed by IndexedDB (0012 AU5).
 *
 * Tokens are secrets: never logged, never included in an export, never rendered in
 * full in the UI. They live in their own table so the snapshot reader can exclude
 * them structurally rather than by remembering to filter (0008 S2, 0012 AU6).
 */
const KEY = 'dropbox-tokens'

/**
 * A credential store, with no opinion about what a credential looks like.
 *
 * Deliberately opaque. This type used to be spelled with Dropbox's own `DropboxTokens`,
 * which meant the storage layer's table was typed by a provider implementation — and
 * adding a second provider, the whole point of 0012 SY6/SY9, would have meant editing
 * `storage/`. With the shape unknown here, a new provider supplies its own parse and
 * nothing below this line changes.
 *
 * The trade is that `read()` hands back whatever is in the table, valid or not. That is
 * the correct place to draw it: only the provider knows what a token for *it* looks
 * like, and `DropboxProvider.toTokens` is where an untrusted record becomes either a
 * usable token or "not connected".
 */
export interface TokenStore {
  /**
   * `null` when nothing is stored, and otherwise whatever was written, unparsed.
   *
   * "No record" and "a record holding null" are deliberately the same answer: only the
   * provider knows whether a null credential means "not connected", and for this one it
   * does. `unknown` rather than `unknown | null`, because `unknown` already includes
   * `null` and spelling both says the distinction is meaningful when it is not.
   */
  read(): Promise<unknown>
  write(value: unknown): Promise<void>
  clear(): Promise<void>
}

export const indexedDbTokenStore: TokenStore = {
  read(): Promise<unknown> {
    return getDb()
      .secrets.get(KEY)
      .then((record) => record?.value ?? null)
  },

  write(value: unknown): Promise<void> {
    // Dexie's put resolves with the key; discard it to match the void contract.
    return getDb()
      .secrets.put({ key: KEY, value })
      .then(() => undefined)
  },

  clear(): Promise<void> {
    return getDb()
      .secrets.delete(KEY)
      .then(() => undefined)
  },
}
