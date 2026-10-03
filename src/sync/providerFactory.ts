import { DropboxProvider } from './dropbox/DropboxProvider'
import { DROPBOX } from './dropbox/config'
import { indexedDbTokenStore } from '../storage/secretsRepo'

/**
 * Provider construction.
 *
 * Kept separate so the redirect handler and the settings panel build an identical
 * provider — two instances with separate PKCE verifiers would mean the second one
 * cannot complete an authorisation the first one started (0012 AU8).
 */
function build(): DropboxProvider {
  // Read through a declared shape rather than indexing `import.meta.env` directly,
  // which is untyped outside a Vite-aware module and yields `any`.
  const env = import.meta.env as unknown as Record<string, string | undefined>
  const clientId = env['VITE_DROPBOX_APP_KEY'] ?? ''
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

export function resetProviderForTests(): void {
  cached = null
}

export const REMOTE_PATH = DROPBOX.defaultRemotePath
