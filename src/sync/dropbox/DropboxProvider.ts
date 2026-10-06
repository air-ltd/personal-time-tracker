import {
  SyncError,
  type ProviderStatus,
  type RemoteFile,
  type SyncErrorKind,
  type SyncProvider,
} from '../provider'
import { DROPBOX, STRICT_CONFLICT } from './config'
import type { TokenStore } from '../../storage/secretsRepo'

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
 * Only what the app actually uses.
 *
 * **Revised.** This used to say a refresh token was deliberately absent, on the reasoning
 * that Dropbox issues one to confidential clients and this is a public PKCE client with no
 * secret. The second half was wrong: Dropbox does issue a refresh token to a PKCE client
 * when `token_access_type` is offline, which is the default for an app that is going to
 * keep using the credential — and the token *response* was already parsed and the field
 * thrown away. So the app was discarding the means of recovering from expiry, and paying
 * for it with a consent-screen round trip every few hours. Item 47 keeps it.
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
  /**
   * Long-lived credential for minting a new access token without the user (SPECS/todo.md
   * item 47).
   *
   * Stored beside the access token in `secrets`, so it is excluded from sync payloads and
   * backups by the table's structure rather than by a filter someone has to remember
   * (0011 R3). Dropbox's own guidance is that this value is sensitive in the same way the
   * access token is.
   */
  refreshToken?: string
}

export interface DropboxProviderOptions {
  clientId: string
  /** Must exactly match a registered redirect URI. */
  redirectUri: string
  storage: TokenStore
  fetchImpl?: typeof fetch
  randomBytes?: (length: number) => Uint8Array
  now?: () => number
}

/**
 * Defensive parse of a stored credential.
 *
 * The value is untrusted input in practice: it survives schema migrations and may have
 * been written by a different build or a different provider. A malformed record reads as
 * "not connected" so the user is prompted to reconnect, rather than the app failing on a
 * shape mismatch or — worse — using a field that happens to be a string.
 *
 * Lives here rather than in `secretsRepo` because only the provider knows what a token
 * for it looks like. The store hands back `unknown`; this is where that becomes either a
 * `DropboxTokens` or nothing.
 */
function toTokens(value: unknown): DropboxTokens | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Partial<DropboxTokens>
  if (typeof candidate.accessToken !== 'string' || candidate.accessToken === '') return null

  return {
    accessToken: candidate.accessToken,
    ...(typeof candidate.expiresAt === 'number' ? { expiresAt: candidate.expiresAt } : {}),
    ...(typeof candidate.accountId === 'string' ? { accountId: candidate.accountId } : {}),
    // Absent on a credential written before this field existed, which is fine: the
    // refresh path checks for it and reports `token-lost` when there is none.
    ...(typeof candidate.refreshToken === 'string' && candidate.refreshToken !== ''
      ? { refreshToken: candidate.refreshToken }
      : {}),
  }
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
  private readonly storage: TokenStore
  private readonly fetchImpl: typeof fetch
  private readonly randomBytes: (length: number) => Uint8Array
  /**
   * The refresh state for this session (SPECS/todo.md item 47).
   *
   * Three states, and the difference between the first two is the whole reason this is
   * not a boolean:
   *
   * - `undefined` — not attempted yet. Worth attempting.
   * - a promise — in flight, shared, so two requests failing at once make one exchange
   *   instead of both minting a token and racing each other's credential write.
   * - `null` — attempted and failed, so the refresh token is dead. Never worth attempting
   *   again this session; without this a tab left open would spend a token exchange per
   *   cycle against a credential that will never work.
   */
  private refreshTokens: Promise<RefreshResult> | null | undefined = undefined
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
  /**
   * Whether there is a credential worth using — which is not the same as an access token
   * that has not expired yet (SPECS/todo.md item 47).
   *
   * This used to answer "is the access token current?", which made the *user-visible* answer
   * to "how often do I have to reconnect" still be the access token's lifetime — about four
   * hours — no matter what else the app could do. Worse, it was checked *before* the refresh
   * path: `ensureAuth()` threw, the engine skipped the cycle, the scheduler read that as a
   * dead credential and discarded it. So the refresh could only ever help for a token that
   * was unexpired but rejected, which is the rare case.
   *
   * A credential with a refresh token is usable, because the first thing any request does
   * with it is make it current. Deliberately answered from local state with no network
   * call, since `status()` reads it to render the connection state.
   */
  async hasUsableToken(): Promise<boolean> {
    const tokens = toTokens(await this.storage.read())
    if (!tokens?.accessToken) return false
    if (tokens.expiresAt !== undefined && tokens.expiresAt <= this.now()) {
      return tokens.refreshToken !== undefined
    }
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
      // Kept rather than discarded. An access token lasts hours; without this the only way
      // past expiry was to send the user back through Dropbox's consent screen, which is
      // why "Sync failed, please reconnect" used to be a routine event rather than a
      // signal that something was wrong.
      ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}),
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
    const tokens = toTokens(await this.storage.read())
    if (!tokens?.accessToken) {
      // No usable token and no interactive sign-in available from here, so the caller
      // must prompt the user. Signalling this as an auth error lets the engine skip
      // the cycle quietly (0012 C4 step 1) rather than reporting a failure.
      throw new SyncError('auth', 'Not connected to Dropbox.')
    }

    if (tokens.expiresAt !== undefined && tokens.expiresAt <= this.now()) {
      // Expired, but refreshable — so make it current rather than reporting a dead
      // credential the user would have to sign in for.
      if (tokens.refreshToken === undefined)
        throw new SyncError('auth', 'Not connected to Dropbox.')
      const outcome = await this.runRefresh()
      if (outcome.ok) return
      throw this.refreshFailure(outcome.reason)
    }
  }

  /** The shared, in-flight refresh, started on first use. */
  private async runRefresh(): Promise<RefreshResult> {
    if (this.refreshTokens === undefined) this.refreshTokens = this.refreshAccessToken()
    // The memo may already be `null` — a refresh this session already found to be
    // rejected — so it is not always something to await. Asked again and reported as
    // rejected, which is what it is.
    return this.refreshTokens ?? { ok: false, reason: 'rejected' }
  }

  /**
   * Refresh if there is anything to refresh with, sharing any exchange already in flight.
   *
   * Returns the new access token, or `null` when there was nothing to do or the refresh
   * failed — in which case the caller has to treat the credential as spent.
   */

  /**
   * Turn a failed refresh into the error the engine should see.
   *
   * `rejected` is `auth`, which the scheduler recovers from by discarding the credential
   * and offering Connect. `unreachable` is `network`, which it does **not** — it backs off
   * and tries again. That single choice is what keeps a dropped connection from signing
   * someone out, and it is why the distinction in `RefreshResult` exists rather than being
   * collapsed into "it failed".
   */
  private refreshFailure(reason: 'rejected' | 'unreachable'): SyncError {
    return reason === 'rejected'
      ? new SyncError('auth', 'Not connected to Dropbox.')
      : new SyncError('network', 'Could not reach Dropbox to renew the connection.')
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
    const arg = { path: normalizePath(path) }

    // POST with the argument in the header: `download` is `style = "download"` with a
    // DownloadArg struct, so the path does not belong in the URL.
    const response = await this.authenticated((accessToken) =>
      this.fetchImpl(DROPBOX.downloadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Dropbox-API-Arg': JSON.stringify(arg),
        },
      }),
    )

    if (response.ok) {
      const rev = response.headers.get('dropbox-api-result')
      const body = await response.text()
      return { body, rev: rev ? parseRev(rev) : 'unknown' }
    }

    const detail = await describeFailure(response, {
      op: `download ${arg.path}`,
      args: arg,
    })
    if (detail.kind === 'not-found') return null
    throw detail.error
  }

  async push(path: string, body: string, expectedRev: string | null): Promise<{ rev: string }> {
    const args = {
      path: normalizePath(path),
      mode: expectedRev ? DROPBOX.updateMode(expectedRev) : DROPBOX.overwriteMode,
      autorename: false,
      mute: true,
      strict_conflict: STRICT_CONFLICT,
    }

    const response = await this.authenticated((accessToken) =>
      this.fetchImpl(DROPBOX.uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify(args),
        },
        body,
      }),
    )

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
    const tokens = toTokens(await this.storage.read())
    if (!tokens?.accessToken) throw new SyncError('auth', 'Not connected to Dropbox.')
    return tokens
  }

  /**
   * Make an authenticated request, refreshing once if the token has expired.
   *
   * An access token lasts hours. Before this, the only recovery was to send the user back
   * through Dropbox's consent screen — so "Sync failed, reconnect" was a routine event that
   * happened on a timer, and a user who had connected Dropbox once would keep being asked
   * to prove it (SPECS/todo.md item 47).
   *
   * **Once, and only on an auth failure.** Two bounds, both load-bearing:
   *
   * - Only a 401/403 triggers it. Refreshing on any failure would spend a round trip on
   *   every rate limit and every offline attempt, and would make a network problem look
   *   like a credential problem.
   * - Only one retry. A refresh token that is itself dead returns `invalid_grant`, and an
   *   unbounded retry against one is a loop that looks like syncing. `refreshTokens` is
   *   held for the duration and cleared by a concurrent refresh, so two requests failing
   *   at once cannot both mint a token and race each other's write.
   *
   * A refresh that fails is reported as `auth`, which is what the scheduler already knows
   * how to recover from: discard the credential and ask the user once.
   */
  private async authenticated(
    send: (accessToken: string) => Promise<Response>,
  ): Promise<Response> {
    const tokens = await this.requireToken()
    const response = await send(tokens.accessToken)
    if (!isAuthFailure(response.status)) return response
    if (tokens.refreshToken === undefined) return response

    const outcome = await this.runRefresh()
    if (!outcome.ok) {
      /*
       * Throwing rather than returning the original 401.
       *
       * Returning it made every refresh failure look like a revoked credential: the 401 was
       * re-classified as `auth`, and the scheduler's response to `auth` is to discard the
       * stored token and ask the user to sign in. So a 502 from the token endpoint cost
       * someone their connection. Throwing here lets the reason through instead.
       */
      throw this.refreshFailure(outcome.reason)
    }
    return await send(outcome.accessToken)
  }

  /**
   * Mints a new access token, or `null` when there is nothing to mint one with.
   *
   * Memoised in `refreshTokens` for the life of the provider so concurrent failures share
   * one exchange. Cleared to `null` — not left rejected — when the exchange fails, so a
   * revoked refresh token is not retried for every subsequent request in the session.
   */
  private async refreshAccessToken(): Promise<RefreshResult> {
    const stored = toTokens(await this.storage.read())
    const refreshToken = stored?.refreshToken
    if (refreshToken === undefined) return { ok: false, reason: 'rejected' }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.clientId,
    })

    try {
      const response = await this.fetchImpl(DROPBOX.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      if (!response.ok) {
        /*
         * Dropbox answered, and the answer was no. That is the credential being rejected.
         *
         * 4xx is Dropbox refusing this token; 5xx and 429 are Dropbox being unavailable or
         * throttling us, which says nothing about the token. Conflating them is what made a
         * transient outage destroy a working connection.
         */
        const refused =
          response.status >= 400 && response.status < 500 && response.status !== 429
        if (refused) this.refreshTokens = null
        return { ok: false, reason: refused ? 'rejected' : 'unreachable' }
      }

      const json = (await response.json()) as {
        access_token?: string
        expires_in?: number
      }
      if (typeof json.access_token !== 'string' || json.access_token === '') {
        // A 200 with no token is not a credential we can use, and there is nothing to
        // retry — but it is still not Dropbox refusing the token, so keep it for a later
        // attempt rather than signing the user out over a malformed response.
        this.refreshTokens = null
        return { ok: false, reason: 'unreachable' }
      }

      await this.storage.write({
        // Spread the existing credential rather than assembling one, so a field added to
        // `DropboxTokens` later is not silently dropped on the first refresh — which is
        // how the refresh token itself was nearly lost.
        ...stored,
        accessToken: json.access_token,
        expiresAt:
          this.now() +
          (typeof json.expires_in === 'number'
            ? json.expires_in
            : TOKEN_TTL_FALLBACK_MS / 1000) *
            1000,
      })
      return { ok: true, accessToken: json.access_token }
    } catch {
      // The request never completed: offline, DNS failure, a blocked request. The token is
      // untouched and unquestioned.
      return { ok: false, reason: 'unreachable' }
    }
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

/**
 * The outcome of trying to mint a new access token.
 *
 * The distinction is `rejected` against `unreachable`, and it is the difference between a
 * credential worth keeping and one worth throwing away. A dropped connection while
 * refreshing says nothing about whether the refresh token still works, and treating it as
 * though it did meant one network blip permanently signed the user out — the precise
 * opposite of retaining a connection.
 */
type RefreshResult =
  { ok: true; accessToken: string } | { ok: false; reason: 'rejected' | 'unreachable' }

/**
 * The HTTP statuses that mean "this credential is no longer valid".
 *
 * Status-based rather than body-based on purpose: the body has to be read to be understood,
 * and by the time it has been parsed the request has already failed for a reason that may
 * not be the credential. Refreshing on a 404 or a 409 would spend a round trip to fix
 * nothing.
 */
function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403
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
