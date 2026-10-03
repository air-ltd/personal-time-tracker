import { SyncError } from './provider'
import { DROPBOX } from './dropbox/config'

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
export async function completeAuthFromRedirect(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error')
  if (!code && !error) return false

  // Clear first: if redemption fails there is nothing to retry, and leaving the code
  // in the URL invites a doomed repeat on reload.
  const clean = window.location.pathname + window.location.hash
  window.history.replaceState({}, '', clean)

  if (error || !code) return false

  try {
    const { indexedDbDropboxProvider } = await import('./providerFactory')
    await indexedDbDropboxProvider().completeAuth(code)
    return true
  } catch (cause) {
    if (cause instanceof SyncError && cause.kind === 'auth') return false
    throw cause
  }
}

export const DROPBOX_REDIRECT_PATH = DROPBOX.defaultRemotePath

/** The redirect URI this deployment must have registered with Dropbox. */
export function currentRedirectUri(): string {
  const env = import.meta.env as unknown as Record<string, string | undefined>
  return `${window.location.origin}${env['BASE_URL'] ?? '/'}`
}
