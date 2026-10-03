/**
 * Sync provider abstraction (0012 SY6–SY9).
 *
 * The engine depends only on this interface, never on a Dropbox client. A second
 * provider must be addable without touching the engine, so nothing above this line
 * may know what a rev is, what a scope is called, or what an app folder is.
 */

export type SyncErrorKind =
  'auth' | 'rate-limited' | 'not-found' | 'conflict' | 'network' | 'unknown'

/**
 * Normalised error (0012 SY8).
 *
 * The engine branches on the kind, never on a provider's error shape, so adding a
 * provider cannot leak its error types into shared code.
 */
export class SyncError extends Error {
  readonly kind: SyncErrorKind
  readonly retryable: boolean

  constructor(kind: SyncErrorKind, message: string) {
    super(message)
    this.name = 'SyncError'
    this.kind = kind
    // Auth is not retryable: retrying a rejected token just burns quota.
    // Rate limits and transient network failures are.
    this.retryable = kind === 'rate-limited' || kind === 'network' || kind === 'conflict'
  }
}

export interface RemoteFile {
  body: string
  /**
   * Opaque provider revision. Used to detect that the remote changed since we last
   * read it, so a concurrent write is merged rather than clobbered.
   */
  rev: string
}

export interface ProviderStatus {
  authenticated: boolean
  account: string | null
}

export interface SyncProvider {
  readonly id: string
  /**
   * Restore or acquire credentials. Must be safe to call when already valid, since
   * it runs at the start of every cycle (0012 C4 step 1).
   */
  ensureAuth(): Promise<void>
  /**
   * Discard credentials. Local data must be untouched (0012 AU7).
   */
  signOut(): Promise<void>
  status(): Promise<ProviderStatus>
  /**
   * Fetch the remote blob. Must return null for "does not exist", which is
   * distinct from an error: a first run and a failed fetch must not look alike.
   */
  pull(path: string): Promise<RemoteFile | null>
  /**
   * Write the blob, enforcing `expectedRev` so a concurrent write is rejected
   * rather than silently overwritten (0012 SY6, C5).
   */
  push(path: string, body: string, expectedRev: string | null): Promise<{ rev: string }>
}
