# Dropbox app registration

**Why this is manual:** creating the app requires signing into your Dropbox
account and accepting Dropbox's developer terms on your behalf. The assistant
cannot and should not do that.

**When to do it:** before or during Phase 1, so Phase 2B has no external
dependency left to wait on. It is the longest-lead item in the plan.

Spec references: [0012 §Authentication](../SPECS/0012-sync.md), and AU3 on the
embedded client id being public.

---

## About these instructions

The App Console UI changes. The **fields and concepts** below are stable and the
instructions are written to survive a relayout, but the exact labels and the
numbering of screens may differ from what you see.

Items marked **[verify]** are the ones most likely to have drifted, or that I am
not confident about. Please check those against Dropbox's own documentation and
correct this file if it is out of date — it is more useful to you amended than to
leave a confident-sounding but wrong instruction.

If a step fails or the console shows something not described here, stop and tell
me what you see rather than guessing your way through it.

---

## 1. Open the App Console

Go to **[console.dropbox.com](https://console.dropbox.com)** and sign in with the
same Dropbox account you want the app to sync to.

Only one account is in scope (0012 FL1 — one user, one file). Do not set this up on
a team account, and do not invite any other Dropbox user as a collaborator.

---

## 2. Create the app

Choose **Create apps** (sometimes labelled **Create app**).

Then:

| Field | Value | Note |
| --- | --- | --- |
| **Access type** | **Scoped access** | Full Dropbox access is for legacy apps. Scoped access is what you want — the app only ever touches one file. |
| **App name** | `personal-time-tracker` | Shown to you in the consent screen. Anything recognisable. |
| **Access** | **App Folder** | This app writes exactly one file, and Dropbox's own guidance is to ask for the least access required. App Folder confines the app to `/apps/<app name>/`. "Full Dropbox" grants reach over the whole account and is not needed. |

The console offers two content-access options: **App Folder** and **Full
Dropbox**. Choose **App Folder**. Because of it, the remote path is relative to the
app folder, so the sync file lives at `/apps/<app name>/data.json` and the
implementation's path constant is just `data.json`.

---

## 3. Choose permissions

This is the step most worth getting right. Grant only what the implementation
actually calls.

The spec's provider interface needs:

| Capability | Expected scope | Used for |
| --- | --- | --- |
| Read file content | `files.content.read` | `pull()` in the provider |
| Write file content | `files.content.write` | `push()` in the provider |
| File metadata | `files.metadata.read` | Reading the revision identifier |
| Account info | `account_info.read` | Showing which account is connected (`status()`) |

**[verify]** These are the long-standing Dropbox scope names. They could not be
confirmed from this machine — `docs.dropboxapi.com` was unreachable — so treat the
console's own list as the authority and use its names if they differ.

Two things worth knowing:

- **`files.metadata.write` may also be needed.** The engine detects a concurrent
  edit by sending the file's revision as a conditional update (0012 C5). If the
  console says that needs a metadata *write* scope, add it. Without it, two devices
  editing at once would overwrite each other instead of conflicting and merging.
- **Scope changes only take effect on re-authorisation.** If you add or remove a
  scope later, disconnect and reconnect the app or the change will not apply.

---

## 4. Add redirect URIs

The OAuth redirect URI must match **exactly** — scheme, host, path, trailing
slash, and port. A mismatch does not produce a useful error; it produces a failed
authorisation with a blank screen or a console error.

Register both of these:

```
https://air-ltd.github.io/personal-time-tracker/

http://localhost:5173/personal-time-tracker/
```

The first is derived from this repository's git remote
(`github.com/air-ltd/personal-time-tracker`) and is the URL the app will be served
from once Phase 1 deploys. It does not work yet — nothing is deployed — but
registering it now means the OAuth config is correct from the first deployment and
does not need revisiting.

The second is for local development, where the scheme is `http` and there is a
port. Note the **path**: the app is served under `/personal-time-tracker/` locally
too, because the build's base path applies in development as well as in production.
The redirect URI the app actually sends is
`${window.location.origin}${import.meta.env.BASE_URL}`, so registering
`http://localhost:5173/` without the path will fail authorisation with no useful
error.

If the console normalises or strips your trailing slash, note what it actually
stored and use that exact form. **[verify]**

A Pages URL ends with a trailing slash. If the console stores the URI without one,
that is the form you must use in the OAuth client config.

---

## 5. Record the app key

At the top of the app's settings page you will find an **App key** — this is the
OAuth **client ID**. You will also see an **App secret**.

Record the **App key**. You need it.

The **App secret is not needed** and must not be used. The app is a public client
using PKCE (0012 AU2), so there is no secret to keep — and there is nowhere safe to
put one anyway, since the app is a static site with every byte shipped to the
browser (0012 AR6).

Dropbox's OAuth guide states this case explicitly: a client-side web application in
pure JavaScript should use the code flow with short-lived tokens and PKCE, **and no
refresh token**. On expiry the app re-authorises, which is normally silent, because
your approval persists until you revoke it. So there is no refresh token to store and
no long-lived credential to leak — a smaller thing to get wrong.

The App key is **not** sensitive. It ships in the JavaScript bundle and that is by
design. This is also why it is fine to commit to the repository.

---

## 6. Wire it into the project

The key belongs in a Vite environment variable. `.env` files that Vite loads are
bundled into the client, which is correct and intended for this value.

Create `.env.example` and commit it:

```
# Dropbox OAuth client id. Public by design under PKCE — not a secret.
# No Dropbox app secret belongs in any VITE_ variable.
VITE_DROPBOX_APP_KEY=
```

Then create a local `.env` (git-ignored) with your App key, and add `.env*` to
`.gitignore` while keeping `.env.example` tracked.

```bash
cp .env.example .env
# edit .env and paste the App key
```

**Never put the app secret in any `VITE_` variable.** Anything prefixed `VITE_`
is embedded in the shipped JavaScript and is readable by anyone loading the page.

**[verify]** Confirm the intended variable name matches what you implement. This
document's `VITE_DROPBOX_APP_KEY` is a suggestion, not something the specs
mandate.

---

## 7. Note the remote path

Decide and record the path of the sync file inside Dropbox, and keep it constant
(0012 FL1 — one user, one file).

With **App Folder** access from step 2, the path is relative to the app folder, so
the implementation's constant is just:

```
data.json
```

which resolves to `/apps/<app-name>/data.json`. The code already uses this
(`src/sync/dropbox/config.ts`). If you chose Full Dropbox instead it becomes
`/personal-time-tracker/data.json`, and that constant needs changing.

Getting this wrong shows up as a sync that silently succeeds while writing
somewhere unexpected, so it is worth being sure which access type you picked.

---

## 8. Confirm before implementing

- [ ] App exists, access type is **Scoped access**
- [ ] Scopes: content read, content write, metadata read, account info — plus
      metadata **write** if step 3 indicates it is needed for conditional updates
- [ ] Redirect URIs registered: deployed Pages URL, and `http://localhost:5173/personal-time-tracker/`
- [ ] App key recorded into `.env`
- [ ] App secret **not** recorded anywhere, not used
- [ ] Remote path decided and written down
- [ ] `.env` git-ignored; `.env.example` committed

---

## What happens next

Authorisation is a user action at runtime, not something configured here. The flow
the implementation must follow is in [0012 AU1–AU8](../SPECS/0012-sync.md):

- Authorization code flow with PKCE. No implicit flow.
- Redirect URI must match one of the registered values exactly.
- Tokens go in IndexedDB, never `localStorage`, and never into an export file.
- Declining or abandoning authorisation leaves a fully working local-only app.

### Verify against Dropbox's documentation

**Already confirmed** from Dropbox's OAuth guide:

- PKCE is supported, and is explicitly recommended for single-page applications
  in pure JavaScript
- The authorization code flow is the recommended flow
- The redirect URI must match a registered value exactly
- Content access is a choice between App Folder and Full Dropbox
- A pure client-side app should use short-lived tokens with **no** refresh token,
  re-authorising on expiry

**Still unconfirmed** — `docs.dropboxapi.com` was unreachable from the build
environment, so these come from long-standing knowledge of the API rather than
current documentation. All of them are isolated in
`src/sync/dropbox/config.ts` so there is one place to correct:

- Endpoint paths for upload, download and token exchange
- The scope strings listed in step 3
- The conditional-update mode flag used to detect a concurrent write
- Whether revisions come from a metadata read or the write response
- Rate limit behaviour, to size the retry and backoff in 0012 C5

These are worth checking before relying on sync against a real account. Nothing in
the test suite covers them: the engine is tested against a fake provider, so the
tests pass regardless of whether these values are right.
