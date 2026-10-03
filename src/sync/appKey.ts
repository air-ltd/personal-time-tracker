/**
 * Where the Dropbox app key comes from (item 6 of `SPECS/todo.md`).
 *
 * The key is an OAuth *client id*, not a secret. Under PKCE there is no client
 * secret and the key ships in the JavaScript bundle either way (0012 AU3, AR6), so
 * a user pasting their own into the browser costs nothing that a rebuild would not
 * already have exposed. What it buys is not needing a rebuild and redeploy to
 * change it.
 *
 * Stored in localStorage rather than IndexedDB because it must be readable
 * synchronously: the OAuth redirect handler runs before the app renders and needs
 * the key to redeem the authorisation code. A synchronous store is also what makes
 * the in-browser setup possible at all.
 *
 * This extends the localStorage allowlist in 0011 R5, which permitted only the
 * theme key. Deliberate, and safe for the same reason: the value is public.
 */

export const APP_KEY_STORAGE_KEY = 'tt:dropbox-app-key'

/**
 * Loose shape check.
 *
 * Dropbox app keys are short lowercase alphanumeric strings. This catches the
 * obvious paste mistakes — a whole URL, a redirect URI, whitespace, the wrong
 * field — without pretending to validate a value only Dropbox can confirm.
 *
 * Note it cannot distinguish the app *secret* from the app key, since both are the
 * same shape. The instructions say so explicitly.
 */
const APP_KEY_PATTERN = /^[a-z0-9]{8,64}$/i

export function isValidAppKey(value: string): boolean {
  return APP_KEY_PATTERN.test(value.trim())
}

function envKey(): string {
  const env = import.meta.env as unknown as Record<string, string | undefined>
  return (env['VITE_DROPBOX_APP_KEY'] ?? '').trim()
}

/** The stored key wins, so a user can override a build-time default. */
export function readAppKey(): string {
  try {
    const stored = window.localStorage.getItem(APP_KEY_STORAGE_KEY)
    if (typeof stored === 'string' && stored.trim() !== '') return stored.trim()
  } catch {
    // localStorage throws under strict privacy settings. Fall through to the env.
  }
  return envKey()
}

/** True when the key came from the environment rather than the user. */
export function isKeyFromEnvironment(): boolean {
  try {
    const stored = window.localStorage.getItem(APP_KEY_STORAGE_KEY)
    if (typeof stored === 'string' && stored.trim() !== '') return false
  } catch {
    // Treated as environment-supplied.
  }
  return envKey() !== ''
}

export function writeAppKey(value: string): boolean {
  const trimmed = value.trim()
  if (!isValidAppKey(trimmed)) return false
  try {
    window.localStorage.setItem(APP_KEY_STORAGE_KEY, trimmed)
    return true
  } catch {
    // Cannot persist. The key still works for this session only.
    return false
  }
}

export function clearAppKey(): void {
  try {
    window.localStorage.removeItem(APP_KEY_STORAGE_KEY)
  } catch {
    // Nothing to do.
  }
}
