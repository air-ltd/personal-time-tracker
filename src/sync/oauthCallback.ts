/**
 * OAuth redirect handling.
 *
 * Dropbox returns the authorisation code in the query string, which the hash-based
 * router never sees. This runs once at startup, before the app renders, and clears
 * the query string afterwards so a refresh does not try to redeem the same code
 * twice — a one-time code would fail on the second attempt and look like a real
 * error.
 *
 * No app state is needed beyond `state`, which exists to correlate the redirect
 * with the request that started it. The code itself is single-use and short-lived,
 * so a stale tab cannot redeem a code belonging to a different session.
 */
/**
 * The single in-flight callback, memoised.
 *
 * `main.tsx` starts this without awaiting it, so a slow or unreachable Dropbox
 * never delays startup (0002 O-1). Anything that needs to *know* whether the
 * authorisation succeeded — the Sync panel deciding between "connected" and "not
 * connected" — awaits this instead of racing it. Querying the token store before the
 * exchange finishes reports "not connected" for an authorisation that actually
 * worked, which is exactly the confusion this avoids.
 */
let inFlight: Promise<boolean> | null = null

export function beginAuthCallback(): Promise<boolean> {
  inFlight ??= completeAuthFromRedirect()
  return inFlight
}

export async function completeAuthFromRedirect(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state') ?? ''
  const error = params.get('error_description') ?? params.get('error')
  if (!code && !error) return false

  // Clear first: if redemption fails there is nothing to retry, and leaving the code
  // in the URL invites a doomed repeat on reload.
  const clean = window.location.pathname + window.location.hash
  window.history.replaceState({}, '', clean)

  if (error) {
    // Dropbox sends these when the user declines or a scope is missing. Logged rather
    // than swallowed, so a failed authorisation is diagnosable instead of just
    // presenting as "not connected".
    console.warn('[tt] Dropbox authorisation did not complete:', error)
    return false
  }
  if (!code) return false

  try {
    const { indexedDbDropboxProvider } = await import('./providerFactory')
    await indexedDbDropboxProvider().completeAuth(code, state)
    return true
  } catch (cause) {
    // Not rethrown: an authorisation failure must not stop the app from starting.
    // The reason is logged and stored so the Sync panel can show it.
    const message = cause instanceof Error ? cause.message : String(cause)
    console.warn('[tt] Dropbox authorisation failed:', message)
    try {
      window.sessionStorage.setItem(AUTH_ERROR_KEY, message)
    } catch {
      // Storage blocked; the console warning above is the only record.
    }
    return false
  }
}

const AUTH_ERROR_KEY = 'tt:dropbox-auth-error'

/** Read and clear the last authorisation failure, for display in the Sync panel. */
export function takeAuthError(): string | null {
  try {
    const value = window.sessionStorage.getItem(AUTH_ERROR_KEY)
    if (value !== null) window.sessionStorage.removeItem(AUTH_ERROR_KEY)
    return value
  } catch {
    return null
  }
}

/**
 * The redirect URI this deployment must have registered with Dropbox.
 *
 * Re-exported so existing importers keep working, but defined in `redirect.ts` so there
 * is exactly one definition. It previously lived here alongside an unused export named
 * `DROPBOX_REDIRECT_PATH` that was assigned the remote *file* path rather than a redirect
 * — a name that read as though it were the thing Dropbox matches on, which it is not.
 */
export { currentRedirectUri } from './redirect'
