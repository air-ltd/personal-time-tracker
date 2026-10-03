import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DropboxProvider, type DropboxTokens, type DropboxTokenStore } from './DropboxProvider'
import { DROPBOX, SCOPES } from './config'
import { SyncError } from '../provider'

const CLIENT_ID = 'app-key-123'
const REDIRECT = 'https://air-ltd.github.io/personal-time-tracker/'

class MemoryTokenStore implements DropboxTokenStore {
  tokens: DropboxTokens | null = null
  read(): Promise<DropboxTokens | null> {
    return Promise.resolve(this.tokens)
  }
  write(tokens: DropboxTokens): Promise<void> {
    this.tokens = tokens
    return Promise.resolve()
  }
  clear(): Promise<void> {
    this.tokens = null
    return Promise.resolve()
  }
}

/** Minimal Response stand-in, so no fetch polyfill is needed. */
function response(options: {
  status: number
  body?: string
  json?: unknown
  headers?: Record<string, string>
}): Response {
  return {
    ok: options.status >= 200 && options.status < 300,
    status: options.status,
    headers: new Headers(options.headers ?? {}),
    text: () => Promise.resolve(options.body ?? ''),
    json: () => Promise.resolve(options.json ?? {}),
  } as unknown as Response
}

function jsonResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: () => Promise.resolve(JSON.stringify(payload)),
    json: () => Promise.resolve(payload),
  } as unknown as Response
}

function makeProvider(store: MemoryTokenStore, fetchImpl: typeof fetch): DropboxProvider {
  return new DropboxProvider({
    clientId: CLIENT_ID,
    redirectUri: REDIRECT,
    storage: store,
    fetchImpl,
    // Deterministic, so the PKCE verifier is assertable.
    randomBytes: (length: number) => new Uint8Array(length).fill(7),
  })
}

let store: MemoryTokenStore
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  store = new MemoryTokenStore()
  fetchMock = vi.fn()
})

describe('PKCE authorisation (0012 AU1–AU2)', () => {
  // Omitting `scope` makes the app's Permissions tab the source of truth for what it
  // may access. Requesting an explicit subset means any disagreement between the
  // console and the code fails the whole authorisation with `scope_not_granted`,
  // which is what blocked both registered apps.
  it('sends no scope parameter, deferring to the app configuration', async () => {
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    const { url } = await provider.beginAuth('state')

    const parsed = new URL(url)
    expect(parsed.searchParams.has('scope')).toBe(false)
  })

  it('leaves every other parameter intact', async () => {
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    const { url } = await provider.beginAuth('state')
    const parsed = new URL(url)

    expect(parsed.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
    expect(parsed.searchParams.get('code_challenge')).toBeTruthy()
    expect(parsed.searchParams.get('state')).toBe('state')
  })

  // Documents what must be ticked on the Permissions tab. Nothing beyond content
  // read/write is used: the revision arrives in the download response header, the
  // conditional write is part of the upload argument, and the account name is read
  // from the stored token rather than the API.
  it('documents exactly the scopes the app needs ticked', () => {
    expect([...SCOPES].sort()).toEqual(['files.content.read', 'files.content.write'])
  })

  it('builds an authorisation URL with S256 and the exact redirect URI', async () => {
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    const { url } = await provider.beginAuth('state-abc')

    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe(DROPBOX.authorizeUrl)
    expect(parsed.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
    expect(parsed.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(parsed.searchParams.get('state')).toBe('state-abc')
    // A challenge must be present and must not be the verifier itself.
    const challenge = parsed.searchParams.get('code_challenge') ?? ''
    expect(challenge.length).toBeGreaterThan(20)
  })

  it('generates a verifier within the permitted character set and length', async () => {
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    await provider.beginAuth('state')
    const verifier = (provider as unknown as { verifier: string }).verifier
    expect(verifier).toMatch(/^[0-9A-Za-z\-._~]{43,128}$/)
  })

  it('produces a different verifier each time', async () => {
    const provider = new DropboxProvider({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT,
      storage: store,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    const first = await provider.beginAuth('a')
    const firstVerifier = (provider as unknown as { verifier: string }).verifier
    await provider.beginAuth('b')
    const secondVerifier = (provider as unknown as { verifier: string }).verifier
    expect(first.url).not.toBe(undefined)
    expect(firstVerifier).not.toBe(secondVerifier)
  })

  it('exchanges the code for a token and stores it', async () => {
    window.sessionStorage.clear()
    fetchMock.mockResolvedValue(
      response({
        status: 200,
        json: { access_token: 'tok-1', expires_in: 14400, account_id: 'dbid:1' },
      }),
    )
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    await provider.beginAuth('state-123')
    await provider.completeAuth('code-123', 'state-123')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const raw = typeof init.body === 'string' ? init.body : ''
    const body = new URLSearchParams(raw)
    expect(init.method).toBe('POST')
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('code-123')
    expect(body.get('code_verifier')).toBeTruthy()
    expect(body.get('redirect_uri')).toBe(REDIRECT)
    expect(store.tokens?.accessToken).toBe('tok-1')
    expect(store.tokens?.accountId).toBe('dbid:1')
  })

  // Per Dropbox's own guidance, a pure client-side app uses short-lived tokens and
  // re-authorises on expiry rather than holding a refresh token. Nothing here keeps one,
  // so there is nothing to assert about it beyond the token being usable.
  it('accepts a response with no refresh token', async () => {
    fetchMock.mockResolvedValue(
      response({ status: 200, json: { access_token: 'tok-1', expires_in: 60 } }),
    )
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    await provider.beginAuth('state-refresh')
    await provider.completeAuth('code', 'state-refresh')
    expect(await provider.hasUsableToken()).toBe(true)
  })

  /**
   * A refresh token arriving from an older build, or from a provider that issues one.
   *
   * Dropped rather than stored. There is no refresh flow to use it, so keeping it would
   * imply a capability the app does not have, and an expired token is recovered by
   * asking the user to authorise again.
   */
  it('does not keep a refresh token even if one is issued', async () => {
    fetchMock.mockResolvedValue(
      response({
        status: 200,
        json: { access_token: 'tok-1', expires_in: 60, refresh_token: 'refresh-1' },
      }),
    )
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    await provider.beginAuth('state-refresh')
    await provider.completeAuth('code', 'state-refresh')

    // No account_id in this response, so nothing beyond the token and its expiry is kept.
    expect(Object.keys(store.tokens ?? {})).toEqual(['accessToken', 'expiresAt'])
  })

  it('refuses to complete an authorisation that was never started', async () => {
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    await expect(provider.completeAuth('orphan-code', 'state')).rejects.toBeInstanceOf(
      SyncError,
    )
  })

  // The bug behind SPECS/todo.md item 7. The OAuth redirect is a full page
  // navigation, so a verifier held only in memory is gone by the time the code
  // comes back, redemption fails, and the user is told they are "not connected"
  // after an authorisation that appeared to succeed.
  it('completes an authorisation across a page reload', async () => {
    window.sessionStorage.clear()
    fetchMock.mockResolvedValue(
      response({ status: 200, json: { access_token: 'tok-after-reload', expires_in: 3600 } }),
    )

    // Before the redirect.
    const first = makeProvider(store, fetchMock as unknown as typeof fetch)
    const { url } = await first.beginAuth('state-round-trip')
    const state = new URL(url).searchParams.get('state')

    // The redirect reloads the page, so a brand new instance handles the callback.
    const afterReload = makeProvider(store, fetchMock as unknown as typeof fetch)
    await afterReload.completeAuth('code-from-redirect', state ?? '')

    expect(store.tokens?.accessToken).toBe('tok-after-reload')
    const body = new URLSearchParams(
      typeof (fetchMock.mock.calls[0]?.[1] as RequestInit).body === 'string'
        ? ((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)
        : '',
    )
    // The verifier sent must be the one generated before the redirect, not empty.
    expect(body.get('code_verifier')).toBeTruthy()
    expect(body.get('code_verifier')?.length ?? 0).toBeGreaterThanOrEqual(43)
  })

  it('rejects a callback whose state does not match', async () => {
    window.sessionStorage.clear()
    fetchMock.mockResolvedValue(response({ status: 200, json: { access_token: 'tok' } }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    await provider.beginAuth('the-real-state')

    await expect(provider.completeAuth('code', 'a-different-state')).rejects.toMatchObject({
      kind: 'auth',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clears the stored verifier once used, so a code cannot be replayed', async () => {
    window.sessionStorage.clear()
    fetchMock.mockResolvedValue(response({ status: 200, json: { access_token: 'tok' } }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    const { url } = await provider.beginAuth('state-once')
    const state = new URL(url).searchParams.get('state') ?? ''
    await provider.completeAuth('code', state)

    await expect(provider.completeAuth('code-again', state)).rejects.toMatchObject({
      kind: 'auth',
    })
  })

  it('reports a rejected authorisation as an auth error, not a failure', async () => {
    fetchMock.mockResolvedValue(response({ status: 400 }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    await provider.beginAuth('state-bad')
    await expect(provider.completeAuth('bad', 'state-bad')).rejects.toMatchObject({
      kind: 'auth',
    })
  })
})

describe('token state', () => {
  it('is not usable with no stored token', async () => {
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    expect(await provider.hasUsableToken()).toBe(false)
    expect(await provider.status()).toEqual({ authenticated: false })
  })

  it('treats an expired token as unusable so the user is re-prompted', async () => {
    const provider = new DropboxProvider({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT,
      storage: store,
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => 1_000_000,
    })
    store.tokens = { accessToken: 'tok', expiresAt: 500_000 }
    expect(await provider.hasUsableToken()).toBe(false)
  })

  // AU7: signing out must not take local data with it.
  it('signs out without touching anything else', async () => {
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }
    await provider.signOut()
    expect(store.tokens).toBeNull()
  })

  it('signals not-connected via an auth error so the engine skips quietly', async () => {
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    await expect(provider.ensureAuth()).rejects.toMatchObject({ kind: 'auth' })
  })
})

describe('pull', () => {
  // `download` is `style = "download"` with a DownloadArg struct, so the argument
  // goes in the Dropbox-API-Arg header on a POST. Sending it in the URL with a GET
  // does not match the endpoint.
  it('POSTs with the path in Dropbox-API-Arg, not in the URL', async () => {
    fetchMock.mockResolvedValue(response({ status: 200, body: '{}' }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }
    await provider.pull('data.json')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(DROPBOX.downloadUrl)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(JSON.parse(headers['Dropbox-API-Arg'] ?? '{}')).toEqual({ path: '/data.json' })
  })

  // The spec declares ReadPath/WritePath as `(/(.|\r\n)*)|(ns:...)` — the leading
  // slash is part of the pattern. Omitting it fails validation and Dropbox returns
  // its catch-all `other/` error, which is what made sync fail.
  it('adds the leading slash the spec requires', async () => {
    fetchMock.mockResolvedValue(response({ status: 200, body: '{}' }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }
    await provider.pull('data.json')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(JSON.parse(headers['Dropbox-API-Arg'] ?? '{}')).toEqual({ path: '/data.json' })
  })

  it('keeps a path that already has its leading slash', async () => {
    fetchMock.mockResolvedValue(response({ status: 200, body: '{}' }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }
    await provider.pull('/data.json')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(JSON.parse(headers['Dropbox-API-Arg'] ?? '{}')).toEqual({ path: '/data.json' })
  })

  it('never doubles the slash', async () => {
    fetchMock.mockResolvedValue(response({ status: 200, body: '{}' }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }
    await provider.pull('//data.json')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(JSON.parse(headers['Dropbox-API-Arg'] ?? '{}')).toEqual({ path: '/data.json' })
  })

  it('returns null when Dropbox reports the file does not exist', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error_summary: 'path/not_found/...' }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }
    expect(await provider.pull('data.json')).toBeNull()
  })

  // A 409 that is not a missing file is a different problem and must not be
  // mistaken for a first run.
  it('does not treat a non-not-found 409 as a missing file', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error_summary: 'path/conflict/file' }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }
    await expect(provider.pull('data.json')).rejects.toBeInstanceOf(SyncError)
  })

  it('returns the body and the revision from the result header', async () => {
    fetchMock.mockResolvedValue(
      response({
        status: 200,
        body: '{"hello":"world"}',
        headers: { 'dropbox-api-result': JSON.stringify({ rev: 'rev-9' }) },
      }),
    )
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }

    const result = await provider.pull('data.json')
    expect(result).toEqual({ body: '{"hello":"world"}', rev: 'rev-9' })
  })

  it('explains an invalid token rather than just the status', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error_summary: 'invalid_access_token/...' }),
    )
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }
    await expect(provider.pull('data.json')).rejects.toThrow(/invalid_access_token/)
  })

  it('surfaces the error summary, which is what makes a failure diagnosable', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error_summary: 'insufficient_permissions/...' }),
    )
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }
    await expect(provider.pull('data.json')).rejects.toThrow(/insufficient_permissions/)
  })

  it('maps a rate limit to a retryable error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error_summary: 'too_many_requests/...' }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }
    await expect(provider.pull('data.json')).rejects.toMatchObject({
      kind: 'rate-limited',
      retryable: true,
    })
  })

  it('sends the bearer token', async () => {
    fetchMock.mockResolvedValue(response({ status: 200, body: '{}' }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'secret-token' }
    await provider.pull('data.json')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer secret-token')
  })
})

describe('push', () => {
  it('overwrites when no revision is expected', async () => {
    fetchMock.mockResolvedValue(response({ status: 200, json: { rev: 'rev-1' } }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }

    const result = await provider.push('data.json', 'body', null)
    expect(result.rev).toBe('rev-1')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const raw = (init.headers as Record<string, string>)['Dropbox-API-Arg'] ?? '{}'
    const args = JSON.parse(raw) as { mode: unknown }
    // union_closed: a void variant is a bare string, with no `.tag` discriminator.
    expect(args.mode).toBe('overwrite')
  })

  // C5: the whole point of sending the revision is to detect a concurrent write.
  it('sends a conditional update when a revision is expected', async () => {
    fetchMock.mockResolvedValue(response({ status: 200, json: { rev: 'rev-2' } }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }

    await provider.push('data.json', 'body', 'rev-1')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const raw = (init.headers as Record<string, string>)['Dropbox-API-Arg'] ?? '{}'
    const args = JSON.parse(raw) as { mode: unknown; strict_conflict?: boolean }
    // `update` carries a value, so it needs the `.tag` discriminator. Dropbox allows a
    // bare string only for a union's Void members, which is why `overwrite` may be
    // `"overwrite"` but `update` may not be `"update"` or `{ "update": ... }`.
    // This assertion previously locked in the untagged form, on the belief that the
    // tag was unnecessary.
    expect(args.mode).toEqual({ '.tag': 'update', update: 'rev-1' })
    // Without this a rev mismatch against a deleted file can pass unnoticed.
    expect(args.strict_conflict).toBe(true)
  })

  // 409 on upload is a conflict, which must trigger re-read and merge, never a
  // blind retry of the same write.
  it('maps a conflict 409 to a retryable conflict', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error_summary: 'path/conflict/file' }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }

    await expect(provider.push('data.json', 'body', 'rev-1')).rejects.toMatchObject({
      kind: 'conflict',
      retryable: true,
    })
  })

  it('requires a token', async () => {
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    await expect(provider.push('data.json', 'body', null)).rejects.toMatchObject({
      kind: 'auth',
    })
  })
})

/** Read a header from the last fetch call, as a mock recorded it. */
function headerOf(mock: ReturnType<typeof vi.fn>, name: string): string {
  const init = mock.mock.calls.at(-1)?.[1] as RequestInit
  const value = (init.headers as Record<string, string>)[name]
  if (typeof value !== 'string') throw new Error(`header ${name} was not set`)
  return value
}

describe('WriteMode wire format', () => {
  /*
   * Dropbox permits a bare string only for a union's Void members, so `overwrite` may
   * be sent as a string while `update`, which carries a rev, must carry the `.tag`
   * discriminator. Omitting it failed with `arg: mode: type: missing tag`, which names
   * no argument and offers no fix.
   */
  it('tags the update mode, which is not a Void member', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { rev: 'r2' }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }

    await provider.push('data.json', 'body', 'rev-123')

    const arg = JSON.parse(headerOf(fetchMock, 'Dropbox-API-Arg')) as {
      mode: Record<string, string>
    }
    expect(arg.mode).toEqual({ '.tag': 'update', update: 'rev-123' })
  })

  it('uses the bare-string shorthand for overwrite, which is a Void member', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { rev: 'r2' }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }

    await provider.push('data.json', 'body', null)

    const arg = JSON.parse(headerOf(fetchMock, 'Dropbox-API-Arg')) as { mode: unknown }
    expect(arg.mode).toBe('overwrite')
  })

  it('sends a leading slash on the path', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { rev: 'r2' }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }

    await provider.push('data.json', 'body', null)

    const arg = JSON.parse(headerOf(fetchMock, 'Dropbox-API-Arg')) as { path: string }
    expect(arg.path).toBe('/data.json')
  })
})
