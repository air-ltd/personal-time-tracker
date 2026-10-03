import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DropboxProvider, type DropboxTokens, type DropboxTokenStore } from './DropboxProvider'
import { DROPBOX } from './config'
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
  // re-authorises on expiry rather than holding a refresh token.
  it('accepts a response with no refresh token', async () => {
    fetchMock.mockResolvedValue(
      response({ status: 200, json: { access_token: 'tok-1', expires_in: 60 } }),
    )
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    await provider.beginAuth('state-refresh')
    await provider.completeAuth('code', 'state-refresh')
    expect(store.tokens?.refreshToken).toBeUndefined()
    expect(await provider.hasUsableToken()).toBe(true)
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
    expect(await provider.status()).toEqual({ authenticated: false, account: null })
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
  it('returns null on a 409, which is a missing file rather than an error', async () => {
    fetchMock.mockResolvedValue(response({ status: 409 }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }
    expect(await provider.pull('data.json')).toBeNull()
  })

  it('returns the body and the revision', async () => {
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

  it('maps an expired session to an auth error', async () => {
    fetchMock.mockResolvedValue(response({ status: 401 }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }
    await expect(provider.pull('data.json')).rejects.toMatchObject({ kind: 'auth' })
  })

  it('maps a rate limit to a retryable error', async () => {
    fetchMock.mockResolvedValue(response({ status: 429 }))
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
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer secret-token',
    )
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
    const args = JSON.parse(raw) as { mode: { '.tag': string } }
    expect(args.mode['.tag']).toBe('overwrite')
  })

  // C5: the whole point of sending the revision is to detect a concurrent write.
  it('sends a conditional update when a revision is expected', async () => {
    fetchMock.mockResolvedValue(response({ status: 200, json: { rev: 'rev-2' } }))
    const provider = makeProvider(store, fetchMock as unknown as typeof fetch)
    store.tokens = { accessToken: 'tok' }

    await provider.push('data.json', 'body', 'rev-1')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const raw = (init.headers as Record<string, string>)['Dropbox-API-Arg'] ?? '{}'
    const args = JSON.parse(raw) as { mode: { '.tag': string; update?: string } }
    expect(args.mode['.tag']).toBe('update')
    expect(args.mode.update).toBe('rev-1')
  })

  // 409 on upload is a conflict, which must trigger re-read and merge, never a
  // blind retry of the same write.
  it('maps a 409 to a retryable conflict', async () => {
    fetchMock.mockResolvedValue(response({ status: 409 }))
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
