/**
 * Dropbox endpoints, scopes and mode flags.
 *
 * VERIFIED against Dropbox's OAuth guide: PKCE is supported and explicitly
 * recommended for single-page applications in pure JavaScript; the code flow is
 * the recommended flow; a redirect URI must match a registered value exactly;
 * content access is a choice between "App Folder" and "Full Dropbox"; and for a
 * client-side web app the documented recommendation is short-lived tokens with *no*
 * refresh token, re-authorising on expiry (which is usually silent, because the
 * user's approval persists).
 *
 * NOT VERIFIED: the endpoint paths, the scope strings and the conditional-update
 * mode flag below. `docs.dropboxapi.com` was unreachable from the build
 * environment, so these come from long-standing knowledge of the API rather than
 * from current documentation. 0012 SY10 requires checking them before relying on
 * this against a real account, and they are collected here so there is exactly one
 * place to correct.
 *
 * They are also not used by any test: the engine is tested against a fake provider,
 * so nothing here can pass while the real API silently differs.
 */
export const DROPBOX = {
  authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
  tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
  uploadUrl: 'https://content.dropboxapi.com/2/files/upload',
  downloadUrl: 'https://content.dropboxapi.com/2/files/download',

  /**
   * Least privilege, as Dropbox's own guide advises. App Folder access confines the
   * app to `/apps/<app name>/`, which is the right choice for an app that writes
   * exactly one file.
   */
  defaultRemotePath: 'data.json',

  scopes: [
    'files.content.read',
    'files.content.write',
    'files.metadata.read',
    'account_info.read',
  ],

  /**
   * Conditional write: fail rather than overwrite if the file changed since it was
   * read. This is what lets the engine detect a concurrent edit (0012 C5) instead of
   * silently clobbering the other device's work.
   */
  updateMode: (rev: string) => ({ '.tag': 'update', update: rev }) as unknown as object,
  overwriteMode: { '.tag': 'overwrite' },
} as const
