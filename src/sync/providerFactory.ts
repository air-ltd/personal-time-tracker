import { DropboxProvider } from './dropbox/DropboxProvider'
import { DROPBOX } from './dropbox/config'
import { indexedDbTokenStore } from '../storage/secretsRepo'
import { readAppKey } from './appKey'
import { currentRedirectUri } from './redirect'

/**
 * Provider construction.
 *
 * Kept separate so the redirect handler and the settings panel build an identical provider.
 * Why that matters is stated once, at the cache below.
 */
function build(): DropboxProvider {
  // The key comes from the user's browser first, then the build-time environment
  // (src/sync/appKey.ts). Read once at construction and held by the instance.
  const clientId = readAppKey()
  return new DropboxProvider({
    clientId,
    // From the shared definition rather than rebuilt here, so the URI the provider sends
    // and the one the setup panel tells the user to register cannot drift apart.
    redirectUri: currentRedirectUri(),
    storage: indexedDbTokenStore,
  })
}

let cached: DropboxProvider | null = null

/**
 * Synchronous and cached.
 *
 * One instance for the whole app. The redirect handler and the settings panel must share
 * it, because a second instance would hold its own PKCE verifier and so could not complete
 * an authorisation the first one began (0012 AU8).
 *
 * That reasoning used to be written out in three places in this one file. Copies of a
 * rationale drift independently — and here one had already begun to, by dropping the half
 * about the verifier — so it lives at the thing it explains.
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
