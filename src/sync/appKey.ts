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
 * Hosts where the deployed, production app is served.
 *
 * The key is chosen by *where the app is running*, not by whether this is a
 * production build: `npm run preview` is a production build served from localhost
 * and should not touch production data.
 */
export const PRODUCTION_HOSTS = ['air-ltd.github.io'] as const

/**
 * Built-in client ids.
 *
 * Both are OAuth *client ids*, which are public identifiers rather than
 * credentials: under PKCE there is no client secret, and the id ships in the bundle
 * whichever way it is supplied. Keeping both here means the deployed site works with
 * no build configuration at all.
 *
 * Two separate Dropbox apps is the point, not a side effect. They have separate app
 * folders, so local testing writes to a different file from the deployed site and
 * cannot overwrite production data.
 */
export const BUILT_IN_KEYS = {
  production: 'gh3s5cqaz4n30ah',
  development: '5k94zo8ymchm1ge',
} as const

export type Environment = keyof typeof BUILT_IN_KEYS

/** Pure, so the host-to-environment mapping can be tested directly. */
export function environmentForHost(hostname: string): Environment {
  return (PRODUCTION_HOSTS as readonly string[]).includes(hostname)
    ? 'production'
    : 'development'
}

/** Pure. Returns the built-in client id for a host, before any override. */
export function selectBuiltInKey(hostname: string): string {
  return BUILT_IN_KEYS[environmentForHost(hostname)]
}

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

/**
 * Resolve the client id, in precedence order:
 *
 *   1. a key the user entered in the Sync panel — an explicit override always wins,
 *      so it works identically on the deployed site and locally;
 *   2. `VITE_DROPBOX_APP_KEY`, for a build-time override;
 *   3. the built-in key for whichever environment this is running in.
 *
 * (1) beats (3) deliberately: someone who pasted a key wants that key, not the one
 * the hostname would pick.
 */
export function readAppKey(): string {
  try {
    const stored = window.localStorage.getItem(APP_KEY_STORAGE_KEY)
    if (typeof stored === 'string' && stored.trim() !== '') return stored.trim()
  } catch {
    // localStorage throws under strict privacy settings. Fall through.
  }

  const fromEnv = envKey()
  if (fromEnv !== '') return fromEnv

  return selectBuiltInKey(window.location.hostname)
}

/** Where the effective key came from, for display in the Sync panel. */
export type KeySource = 'user' | 'environment' | 'builtin'

export function describeKeySource(): { source: KeySource; environment: Environment } {
  const environment = environmentForHost(window.location.hostname)
  try {
    const stored = window.localStorage.getItem(APP_KEY_STORAGE_KEY)
    if (typeof stored === 'string' && stored.trim() !== '')
      return { source: 'user', environment }
  } catch {
    // Treated as not user-supplied.
  }
  if (envKey() !== '') return { source: 'environment', environment }
  return { source: 'builtin', environment }
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
