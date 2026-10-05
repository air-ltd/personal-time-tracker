/**
 * The OAuth redirect URI for this deployment (0005 P7, 0012 AU3).
 *
 * Lives in its own module because three call sites need it — the provider, the redirect
 * handler and the setup panel — and two of those already import each other. Defining it
 * once avoids the possibility of the provider registering one URI while the panel tells
 * the user to register another, which is a mismatch Dropbox reports only as
 * `invalid_redirect_uri` with nothing to say about which half was wrong.
 *
 * No imports, deliberately: this sits below everything in `sync/`.
 */
function basePath(): string {
  // Read through a declared shape: `import.meta.env` is untyped outside a Vite-aware
  // module and yields `any`.
  const env = import.meta.env as unknown as Record<string, string | undefined>
  // `BASE_URL` carries the trailing slash the router and Vite both assume, so a redirect
  // to `/personal-time-tracker` (no slash) would not match what is registered.
  return env['BASE_URL'] ?? '/'
}

export function currentRedirectUri(): string {
  return `${window.location.origin}${basePath()}`
}

/**
 * A name for the app's own URL, which is also its OAuth redirect.
 *
 * Delegates rather than recomputing. The two were byte-identical implementations under two
 * names and two rationales, so a change to how the base path is derived would have had to
 * be made twice and nothing would say the two had to agree.
 *
 * Where this repository is published.
 *
 * Only the host, because the path is derived from `BASE_URL` and therefore follows a
 * rename on its own. The path used to be written out in full in the setup panel, so
 * renaming the repository would have left the panel telling the user to register a URI
 * that no longer existed — a mismatch Dropbox reports only as `invalid_redirect_uri`.
 *
 * A fork serves from a different host, so this is deployment configuration rather than
 * something derivable: the live origin when running on Pages, and nothing meaningful
 * during local development, which is why it is only used to *display* the deployed URI.
 */
export const DEPLOYED_ORIGIN = 'https://air-ltd.github.io'

/** The redirect URI for the deployed site, for display in the setup panel. */
export function deployedRedirectUri(): string {
  return `${DEPLOYED_ORIGIN}${basePath()}`
}

/**
 * The app's own home, relative to wherever it is being served (item 15).
 *
 * Relative on purpose. Items 11 and 15 asked for the header title to link to the
 * personal-time-tracker page, and the first attempt resolved that to the deployed
 * origin — which sends a fork, or a local `npm run dev`, off to somebody else's site.
 * Deriving it from the current origin plus the configured base means the same build
 * links to itself wherever it is served from, including a subdirectory.
 *
 * The trailing slash matters: without it, a server that redirects `/personal-time-tracker`
 * to the directory can turn the click into a 404 on some hosts.
 */
export function appHomeUrl(): string {
  return currentRedirectUri()
}
