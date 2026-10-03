import {
  SyncError,
  type ProviderStatus,
  type RemoteFile,
  type SyncErrorKind,
  type SyncProvider,
} from '../provider'
import { DROPBOX, STRICT_CONFLICT } from './config'

/**
 * Dropbox provider (0012 SY9).
 *
 * All Dropbox specifics — URLs, scopes, mode flags, status codes — live here or in
 * `config.ts`. Nothing above this file imports from this directory, so adding a
 * second provider does not touch the engine.
 */

/**
 * The stored credential.
 *
 * Only what the app actually uses. A refresh token is deliberately absent: Dropbox issues
 * one to confidential clients, and this is a public PKCE client with no secret, so there
 * is nothing to refresh with — and even if one arrived, there is no refresh flow. An
 * expired token is recovered by asking the user to authorise again, which the scheduler
 * triggers by discarding the token it cannot use.
 *
 * `displayName` went for the same reason in the other direction: reading an account name
 * needs the `account_info.read` scope, and requesting a third permission purely to show a
 * label in the UI is a poor trade for a permission the user has to approve.
 */
export interface DropboxTokens {
  accessToken: string
  /** Absent when the provider did not return an expiry. */
  expiresAt?: number
  accountId?: string
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
    // Deliberately no `scope` parameter. Dropbox documents that omitting it requests
    // exactly the scopes selected on the app's Permissions tab, which makes the
    // console the single source of truth for what the app may access.
    //
    // Requesting an explicit subset is the fragile choice: whenever the console and
    // the code disagree by even one scope, Dropbox rejects the whole authorisation
    // with `scope_not_granted` and the app cannot start at all. That is not
    // hypothetical — it is what happened on both registered apps. Least privilege is
    // still achieved, by ticking only the two scopes in the console; the app's own
    // setup instructions say exactly that.
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
    return { authenticated: await this.hasUsableToken() }
  }

  async pull(path: string): Promise<RemoteFile | null> {
    const tokens = await this.requireToken()
    // POST with the argument in the header: `download` is `style = "download"` with a
    // DownloadArg struct, so the path does not belong in the URL.
    const response = await this.fetchImpl(DROPBOX.downloadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({ path: normalizePath(path) }),
      },
    })

    if (response.ok) {
      const rev = response.headers.get('dropbox-api-result')
      const body = await response.text()
      return { body, rev: rev ? parseRev(rev) : 'unknown' }
    }

    const detail = await describeFailure(response, {
      op: `download ${normalizePath(path)}`,
      args: { path: normalizePath(path) },
    })
    if (detail.kind === 'not-found') return null
    throw detail.error
  }

  async push(path: string, body: string, expectedRev: string | null): Promise<{ rev: string }> {
    const tokens = await this.requireToken()
    const args = {
      path: normalizePath(path),
      mode: expectedRev ? DROPBOX.updateMode(expectedRev) : DROPBOX.overwriteMode,
      autorename: false,
      mute: true,
      strict_conflict: STRICT_CONFLICT,
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

    if (response.ok) {
      const json = (await response.json()) as { rev?: string }
      return { rev: json.rev ?? 'unknown' }
    }

    const detail = await describeFailure(response, { op: `upload ${args.path}`, args })
    if (detail.kind === 'conflict') {
      throw new SyncError('conflict', 'The remote file changed before this write landed.')
    }
    throw detail.error
  }

  private async requireToken(): Promise<DropboxTokens> {
    const tokens = await this.storage.read()
    if (!tokens?.accessToken) throw new SyncError('auth', 'Not connected to Dropbox.')
    return tokens
  }
}

/**
 * Dropbox paths MUST begin with a slash.
 *
 * The spec declares `WritePath` and `ReadPath` as strings matching
 * `(/(.|\r\n)*)|(ns:...)` — the leading slash is part of the pattern, not a
 * convention. A path without one fails validation and Dropbox answers with its
 * catch-all `other/` error, which says nothing useful.
 *
 * With App Folder access the slash is relative to the app folder, so `/data.json`
 * resolves to `/apps/<app name>/data.json`. It does not address the account root.
 */
function normalizePath(path: string): string {
  // Collapse any run of leading slashes to one, so a path pasted or configured with
  // extra slashes still addresses the intended file rather than a differently-named
  // one.
  return `/${path.trim().replace(/^\/+/, '')}`
}

interface FailureDetail {
  kind: SyncErrorKind
  error: SyncError
}

/**
 * Turn a failed response into a classified, explained error.
 *
 * Dropbox returns a JSON body containing `error_summary` — values such as
 * `path/not_found/`, `path/conflict/file` or `invalid_access_token` — which say
 * exactly what went wrong. Discarding it and reporting only "upload failed (409)"
 * is what makes a real failure undiagnosable from the app.
 */
async function describeFailure(
  response: Response,
  call: { op: string; args: unknown },
): Promise<FailureDetail> {
  const status = response.status

  // Read once, as text. `response.json()` consumed the body on the failure paths that
  // turned out to be non-JSON, and an unreadable body left the error with no detail at
  // all — which is what forced a guess about the cause.
  const raw = (await response.text()).trim()

  let summary = ''
  try {
    const body = JSON.parse(raw) as { error_summary?: string; error?: unknown }
    summary = body.error_summary ?? (body.error ? JSON.stringify(body.error) : '')
  } catch {
    // Not JSON. Dropbox answers some malformed requests with an empty or plain-text
    // body, so the status and the raw text are all there is to go on.
  }

  // Everything known about the failure, in one string. A response with no usable body
  // is the case that matters most and previously carried the least information, so
  // the raw text is included rather than discarded.
  const detail =
    `\nHTTP ${status} on ${call.op}` +
    `\nargs: ${JSON.stringify(call.args)}` +
    (summary ? `\nDropbox said: ${summary}` : '') +
    (raw && !summary ? `\nbody: ${raw.slice(0, 300)}` : '')

  if (status === 401) {
    return {
      kind: 'auth',
      error: new SyncError('auth', `Dropbox rejected the token.${detail}`),
    }
  }
  if (status === 429) {
    return {
      kind: 'rate-limited',
      error: new SyncError('rate-limited', `Dropbox rate limit reached.${detail}`),
    }
  }
  if (status === 409) {
    if (summary.includes('not_found')) {
      // A missing file is a normal first-run state, not a failure.
      return { kind: 'not-found', error: new SyncError('not-found', 'File not found.') }
    }
    return {
      kind: 'conflict',
      error: new SyncError('conflict', `The remote file changed.${detail}`),
    }
  }
  if (summary.startsWith('missing_scope')) {
    // Dropbox names this precisely, so the fix is known rather than guessed: the token
    // carries no file permissions. Authorisation succeeds without any — consent is
    // given for whatever the app has ticked, and a new app has none — so it surfaces
    // here, on the first file call.
    return {
      kind: 'scope-missing',
      error: new SyncError(
        'scope-missing',
        `The Dropbox connection has no file permissions.${detail}`,
      ),
    }
  }

  // No specific case for the remainder, so report what came back instead of guessing
  // at a cause. A previous version asserted the most common cause — that no
  // permissions were ticked — which was wrong once they were, and sent the debugging
  // in the wrong direction while hiding the status and body that would have shown it.
  return {
    kind: 'unknown',
    error: new SyncError(
      'unknown',
      `Dropbox rejected the request without saying why.${detail}`,
    ),
  }
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
