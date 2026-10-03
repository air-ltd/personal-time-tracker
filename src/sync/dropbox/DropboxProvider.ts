import { SyncError, type ProviderStatus, type RemoteFile, type SyncProvider } from '../provider'
import { DROPBOX } from './config'

/**
 * Dropbox provider (0012 SY9).
 *
 * All Dropbox specifics — URLs, scopes, mode flags, status codes — live here or in
 * `config.ts`. Nothing above this file imports from this directory, so adding a
 * second provider does not touch the engine.
 */

export interface DropboxTokens {
  accessToken: string
  /** Absent when the provider did not issue a refresh token (see config.ts). */
  refreshToken?: string
  expiresAt?: number
  accountId?: string
  displayName?: string
}

export interface DropboxProviderOptions {
  clientId: string
  /** Must exactly match a registered redirect URI. */
  redirectUri: string
  storage: DropboxTokenStore
  fetchImpl?: typeof fetch
  randomBytes?: (length: number) => Uint8Array
  now?: () => number
}

export interface DropboxTokenStore {
  read(): Promise<DropboxTokens | null>
  write(tokens: DropboxTokens): Promise<void>
  clear(): Promise<void>
}

const TOKEN_TTL_FALLBACK_MS = 4 * 60 * 60 * 1000

/**
 * Where the pending authorisation is parked across the redirect.
 *
 * sessionStorage is correct and deliberate: it survives a same-tab navigation, which
 * is exactly the one journey this needs to survive, and it is scoped to the tab and
 * discarded when the tab closes. localStorage would outlive the authorisation and
 * leave a token-exchange credential lying around for no reason.
 *
 * The verifier is a short-lived secret — it is what proves the token request belongs
 * to the authorisation request — so it is kept out of localStorage and out of any
 * export (0011 R7).
 */
const PENDING_KEY = 'tt:dropbox-pending'

interface PendingAuth {
  verifier: string
  state: string
  createdAt: number
}

/** Ten minutes: long enough for a login and a consent screen, short enough to expire. */
const PENDING_TTL_MS = 10 * 60 * 1000

export class DropboxProvider implements SyncProvider {
  readonly id = 'dropbox'
  private readonly clientId: string
  private readonly redirectUri: string
  private readonly storage: DropboxTokenStore
  private readonly fetchImpl: typeof fetch
  private readonly randomBytes: (length: number) => Uint8Array
  private readonly now: () => number
  /**
   * The pending PKCE verifier, cached for the duration of the round trip.
   *
   * Never sufficient on its own: the OAuth redirect is a full page navigation, so
   * anything held only in memory is gone by the time the code returns. `sessionKey`
   * is the durable copy that makes the flow work at all.
   */
  private verifier: string | null = null
  private inMemoryState: string | null = null

  constructor(options: DropboxProviderOptions) {
    this.clientId = options.clientId
    this.redirectUri = options.redirectUri
    this.storage = options.storage
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args))
    this.randomBytes = options.randomBytes ?? defaultRandomBytes
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * True when a stored token is present and not known to be expired.
   *
   * Deliberately tolerant: Dropbox's documented pattern is to re-authorise on
   * expiry, which is usually silent because the user's approval persists. Being
   * strict here would prompt unnecessarily.
   */
  async hasUsableToken(): Promise<boolean> {
    const tokens = await this.storage.read()
    if (!tokens?.accessToken) return false
    if (tokens.expiresAt !== undefined && tokens.expiresAt <= this.now()) return false
    return true
  }

  /**
   * Build the URL to send the user to.
   *
   * Async because the PKCE S256 challenge is a SHA-256 digest, and `crypto.subtle`
   * has no synchronous digest. Omitting the challenge would mean using the `plain`
   * method, which Dropbox documents as supported but not recommended.
   */
  async beginAuth(state: string): Promise<{ url: string }> {
    const verifier = base64Url(this.randomBytes(64))
    this.verifier = verifier
    this.inMemoryState = state
    this.writePending({ verifier, state, createdAt: this.now() })

    const url = new URL(DROPBOX.authorizeUrl)
    url.searchParams.set('client_id', this.clientId)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', this.redirectUri)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('code_challenge', base64Url(await sha256(verifier)))
    url.searchParams.set('state', state)
    // App Folder scope is implied by app configuration; scopes are still requested
    // explicitly so a scope added later does not require a console change.
    for (const scope of DROPBOX.scopes) url.searchParams.set('scope', scope)
    return { url: url.toString() }
  }

  /**
   * Exchange the authorisation code from the redirect for tokens.
   *
   * `state` is checked against the value stored by `beginAuth`. Without that check a
   * third party could feed this app an authorisation code of their choosing, and the
   * app would silently adopt whichever Dropbox account that code belongs to
   * (0012 AU9).
   */
  async completeAuth(code: string, state: string): Promise<void> {
    const pending = this.readPending()

    if (!pending) {
      throw new SyncError(
        'auth',
        'This authorisation link has expired or was started in a different browser tab. Start again from the Sync panel.',
      )
    }
    if (pending.state !== state) {
      // Drop it: a mismatched state means this callback is not ours.
      this.clearPending()
      throw new SyncError('auth', 'Authorisation state did not match. Start again.')
    }

    const body = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      code_verifier: pending.verifier,
    })

    const response = await this.fetchImpl(DROPBOX.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!response.ok) {
      throw new SyncError('auth', `Authorisation failed (${response.status}).`)
    }

    const json = (await response.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      account_id?: string
    }
    if (!json.access_token) {
      throw new SyncError('auth', 'Authorisation response contained no access token.')
    }

    await this.storage.write({
      accessToken: json.access_token,
      // Present only if the provider issued one; not required for a pure client-side
      // app, and its absence is not an error.
      ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}),
      ...(json.expires_in !== undefined
        ? { expiresAt: this.now() + json.expires_in * 1000 }
        : { expiresAt: this.now() + TOKEN_TTL_FALLBACK_MS }),
      ...(json.account_id ? { accountId: json.account_id } : {}),
    })
    this.verifier = null
    this.inMemoryState = null
    this.clearPending()
  }

  private writePending(pending: PendingAuth): void {
    try {
      window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))
    } catch {
      // Without this the round trip cannot complete, so surface it at the point of
      // the redirect rather than after a confusing failure on the way back.
      throw new SyncError(
        'auth',
        'This browser is blocking session storage, so the Dropbox authorisation cannot be completed.',
      )
    }
  }

  private readPending(): PendingAuth | null {
    let raw: string | null
    try {
      raw = window.sessionStorage.getItem(PENDING_KEY)
    } catch {
      // Storage is blocked. Fall back to the in-memory copy: that only works if no
      // navigation happened, but it is better than failing outright.
      return this.verifier && this.inMemoryState
        ? { verifier: this.verifier, state: this.inMemoryState, createdAt: this.now() }
        : null
    }
    if (!raw) return null

    try {
      const parsed = JSON.parse(raw) as Partial<PendingAuth>
      if (
        typeof parsed.verifier !== 'string' ||
        parsed.verifier === '' ||
        typeof parsed.state !== 'string' ||
        typeof parsed.createdAt !== 'number'
      ) {
        return null
      }
      // Expire it, so a stale entry cannot be replayed much later.
      if (this.now() - parsed.createdAt > PENDING_TTL_MS) {
        this.clearPending()
        return null
      }
      return { verifier: parsed.verifier, state: parsed.state, createdAt: parsed.createdAt }
    } catch {
      return null
    }
  }

  private clearPending(): void {
    try {
      window.sessionStorage.removeItem(PENDING_KEY)
    } catch {
      // Nothing more to do.
    }
  }

  async ensureAuth(): Promise<void> {
    if (await this.hasUsableToken()) return
    // No usable token and no interactive sign-in available from here, so the caller
    // must prompt the user. Signalling this as an auth error lets the engine skip
    // the cycle quietly (0012 C4 step 1) rather than reporting a failure.
    throw new SyncError('auth', 'Not connected to Dropbox.')
  }

  async signOut(): Promise<void> {
    // Local data is deliberately untouched (0012 AU7).
    this.verifier = null
    this.inMemoryState = null
    this.clearPending()
    await this.storage.clear()
  }

  async status(): Promise<ProviderStatus> {
    if (!(await this.hasUsableToken())) return { authenticated: false, account: null }
    const tokens = await this.storage.read()
    return { authenticated: true, account: tokens?.displayName ?? null }
  }

  async pull(path: string): Promise<RemoteFile | null> {
    const tokens = await this.requireToken()
    const response = await this.fetchImpl(`${DROPBOX.downloadUrl}/${encodePath(path)}`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    })

    if (response.status === 409) {
      // Dropbox returns 409 with a path-not-found error for a missing file, which
      // is a normal first-run state rather than a failure.
      return null
    }
    if (response.status === 401) throw new SyncError('auth', 'Dropbox session expired.')
    if (response.status === 429) throw new SyncError('rate-limited', 'Dropbox rate limit.')
    if (!response.ok) throw new SyncError('unknown', `Download failed (${response.status}).`)

    const rev = response.headers.get('dropbox-api-result')
    const body = await response.text()
    return { body, rev: rev ? parseRev(rev) : 'unknown' }
  }

  async push(path: string, body: string, expectedRev: string | null): Promise<{ rev: string }> {
    const tokens = await this.requireToken()
    const args = {
      path: encodePath(path),
      mode: expectedRev ? DROPBOX.updateMode(expectedRev) : DROPBOX.overwriteMode,
      autorename: false,
      mute: true,
    }

    const response = await this.fetchImpl(DROPBOX.uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify(args),
      },
      body,
    })

    if (response.status === 409) {
      // A conflict here means the file moved on since the pull. The engine treats
      // this as a signal to re-read and merge, never to retry the same write.
      throw new SyncError('conflict', 'The remote file changed before this write landed.')
    }
    if (response.status === 401) throw new SyncError('auth', 'Dropbox session expired.')
    if (response.status === 429) throw new SyncError('rate-limited', 'Dropbox rate limit.')
    if (!response.ok) throw new SyncError('unknown', `Upload failed (${response.status}).`)

    const json = (await response.json()) as { rev?: string }
    return { rev: json.rev ?? 'unknown' }
  }

  private async requireToken(): Promise<DropboxTokens> {
    const tokens = await this.storage.read()
    if (!tokens?.accessToken) throw new SyncError('auth', 'Not connected to Dropbox.')
    return tokens
  }
}

function encodePath(path: string): string {
  return path.replace(/^\/+/, '')
}

function parseRev(header: string): string {
  try {
    const parsed = JSON.parse(header) as { rev?: string }
    return parsed.rev ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function defaultRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  const webCrypto = globalThis.crypto
  if (!webCrypto?.getRandomValues) {
    throw new SyncError('auth', 'No secure random source available for PKCE.')
  }
  webCrypto.getRandomValues(bytes)
  return bytes
}

/**
 * Base64url (RFC 4648 §5): standard base64 with `+`/`/` swapped and padding
 * stripped, which is what PKCE requires for the verifier and challenge.
 */
function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(value: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(value)
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new SyncError('auth', 'No subtle crypto available for the PKCE challenge.')
  }
  return new Uint8Array(await subtle.digest('SHA-256', encoded))
}
