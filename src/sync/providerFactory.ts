import { DropboxProvider } from './dropbox/DropboxProvider'
import { DROPBOX } from './dropbox/config'
import { indexedDbTokenStore } from '../storage/secretsRepo'
import { readAppKey } from './appKey'

/**
 * Provider construction.
 *
 * Kept separate so the redirect handler and the settings panel build an identical
 * provider — two instances with separate PKCE verifiers would mean the second one
 * cannot complete an authorisation the first one started (0012 AU8).
 */
function build(): DropboxProvider {
  // The key comes from the user's browser first, then the build-time environment
  // (src/sync/appKey.ts). Read once at construction and held by the instance: a
  // second instance would carry its own PKCE verifier and so could not complete an
  // authorisation the first one began (0012 AU8).
  const clientId = readAppKey()
  // Read through a declared shape: `import.meta.env` is untyped outside a
  // Vite-aware module and yields `any`.
  const env = import.meta.env as unknown as Record<string, string | undefined>
  return new DropboxProvider({
    clientId,
    redirectUri: `${window.location.origin}${env['BASE_URL'] ?? '/'}`,
    storage: indexedDbTokenStore,
  })
}

let cached: DropboxProvider | null = null

/**
 * Synchronous and cached.
 *
 * One instance for the whole app: the redirect handler and the settings panel must
 * share it, because a second instance would hold its own PKCE verifier and so could
 * not complete an authorisation the first one began (0012 AU8).
 */
export function indexedDbDropboxProvider(): DropboxProvider {
  cached ??= build()
  return cached
}

/**
 * Discard the cached provider so the next call rebuilds it.
 *
 * Needed when the app key changes: the old instance holds the previous client id,
 * and OAuth would fail confusingly.
 */
export function resetProvider(): void {
  cached = null
}

export const REMOTE_PATH = DROPBOX.defaultRemotePath
