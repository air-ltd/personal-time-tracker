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
 * Resolve the client id.
 *
 * The built-in key for this host wins. A key saved in the browser is deliberately
 * NOT consulted: it silently overrode the host selection and then paired with
 * whichever redirect URI that other app had registered, so authorising locally used
 * the production app's key against the production app's redirect — and Dropbox
 * rejected it with "Invalid redirect_uri", naming nothing useful.
 *
 * Two built-in keys cover both environments, which is what the in-browser entry was
 * originally for (`SPECS/todo.md` item 6), so nothing is lost. A genuinely
 * different Dropbox app is still possible via `VITE_DROPBOX_APP_KEY`, an explicit
 * deploy-time decision rather than hidden browser state.
 *
 * Storage is deliberately synchronous: the OAuth redirect handler reads this before
 * the app renders.
 */
export function readAppKey(): string {
  const fromEnv = envKey()
  if (fromEnv !== '') return fromEnv
  return selectBuiltInKey(window.location.hostname)
}

export type KeySource = 'environment' | 'builtin'

export function describeKeySource(): { source: KeySource; environment: Environment } {
  return {
    source: envKey() === '' ? 'builtin' : 'environment',
    environment: environmentForHost(window.location.hostname),
  }
}

/**
 * Remove a key saved by an earlier version.
 *
 * Retained so the leftover can be cleaned up. `readAppKey` ignores it either way, so
 * this is hygiene rather than behaviour.
 */
export function clearAppKey(): void {
  try {
    window.localStorage.removeItem(APP_KEY_STORAGE_KEY)
  } catch {
    // Nothing to do.
  }
}

/** True if an earlier version left a key behind. */
export function hasLegacyStoredKey(): boolean {
  try {
    const stored = window.localStorage.getItem(APP_KEY_STORAGE_KEY)
    return typeof stored === 'string' && stored.trim() !== ''
  } catch {
    return false
  }
}
