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
export function currentRedirectUri(): string {
  // Read through a declared shape: `import.meta.env` is untyped outside a Vite-aware
  // module and yields `any`.
  const env = import.meta.env as unknown as Record<string, string | undefined>
  // `BASE_URL` carries the trailing slash the router and Vite both assume, so a redirect
  // to `/personal-time-tracker` (no slash) would not match what is registered.
  return `${window.location.origin}${env['BASE_URL'] ?? '/'}`
}
