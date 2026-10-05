/**
 * Dropbox endpoints, scopes and argument shapes.
 *
 * VERIFIED against `dropbox/dropbox-api-spec` (`files.stone`, the authoritative
 * machine-readable spec) and Dropbox's OAuth guide:
 *
 * - `upload` and `download` are both `host = "content"`, i.e.
 *   `content.dropboxapi.com`, and both set `allow_app_folder_app = true`, so App
 *   Folder access is valid.
 * - `download` requires `files.content.read`; `upload` requires
 *   `files.content.write`. Both are `auth = "user"`, so a bearer token is right.
 * - `download` is `style = "download"` with a `DownloadArg` struct, so its
 *   arguments travel in the `Dropbox-API-Arg` header, not the URL.
 * - `WriteMode` is a `union_closed`. Its Void member serialises as a bare string, and
 *   the member that carries a value needs an object — which is what `updateMode` and
 *   `overwriteMode` below each emit, and why the two are spelled differently.
 *
 *   An earlier version of this comment claimed there was "no `.tag` discriminator",
 *   which is the opposite of what the code two dozen lines below does and says, citing
 *   the same spec. Both were confident; only one was right. The per-member comments
 *   are now the single place this is explained.
 *
 * A pure client-side app should use short-lived tokens with no refresh token,
 * re-authorising on expiry, which is usually silent because the user's approval
 * persists.
 */

/** Scopes this app actually uses. Least privilege, as Dropbox's guide advises. */
export const SCOPES = ['files.content.read', 'files.content.write'] as const

export const DROPBOX = {
  authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
  tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
  uploadUrl: 'https://content.dropboxapi.com/2/files/upload',
  downloadUrl: 'https://content.dropboxapi.com/2/files/download',

  /**
   * Relative to the app folder. With App Folder access the file lives at
   * `/apps/<app name>/data.json`.
   */
  defaultRemotePath: 'data.json',

  scopes: SCOPES,

  /**
   * `WriteMode`, as a `union_closed` serialises it.
   *
   * `update` with a rev makes the write conditional: Dropbox rejects it unless the
   * file's current rev matches. That rejection is how a concurrent edit from another
   * device is detected instead of silently overwritten (0012 C5).
   *
   * The `.tag` discriminator is mandatory here. Dropbox permits a bare string only for
   * a union's Void members, so `"mode": "overwrite"` and `"mode": "add"` are accepted
   * while `update` — which carries a value — is not. Omitting the tag fails with
   * `arg: mode: type: missing tag`, which says nothing about which argument is wrong.
   */
  updateMode: (rev: string): Record<string, string> => ({ '.tag': 'update', update: rev }),
  /**
   * `overwrite` is a Void member, so the bare-string shorthand Dropbox documents for
   * those is valid. Spelled out here rather than inlined so both modes sit together
   * and the asymmetry between them is visible.
   */
  overwriteMode: 'overwrite' as const,
} as const

/**
 * Whether to pass a `strict_conflict` flag on writes.
 *
 * From the spec: with `mode = update`, a rev mismatch is only *always* an error when
 * `strict_conflict` is set — without it, a mismatch against a file that has since
 * been deleted can pass unnoticed. For a sync file, "the file changed under me"
 * must never be silent, so this is on.
 */
export const STRICT_CONFLICT = true
