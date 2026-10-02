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
| **Access** | **My Dropbox** (or *Full Dropbox*, depending on console version) | Not an App Folder. App Folder access pins the app inside `/Apps/<name>`, which is also fine — see §7. |

**[verify]** The access-type wording differs between console versions. Scoped
access with "My Dropbox" is what the spec assumes, where paths are relative to
your Dropbox root. If you pick App Folder instead, note the path change — the
remote path constant in the implementation will need it.

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

**[verify]** These scope names are the long-standing Dropbox names and are
expected to be correct, but check them against the console's own list, which is
the authority. If a scope is offered under a different name, use the console's
name.

**Two things worth knowing:**

- **`files.metadata.write` may also be needed.** The sync engine detects concurrent
  modification using a revision value and passes it as an expected revision when
  writing (0012 C5). Dropbox implements this as a conditional update, and it is
  worth checking in the console whether that requires a metadata *write* scope
  rather than only a read. If so, add it. Without it, concurrent edits from two
  devices would clobber each other instead of conflicting cleanly.
- **Scope changes take effect on re-authorisation.** If you add or remove a scope
  later, you must disconnect and reconnect the app, or the change will not apply.

---

## 4. Add redirect URIs

The OAuth redirect URI must match **exactly** — scheme, host, path, trailing
slash, and port. A mismatch does not produce a useful error; it produces a failed
authorisation with a blank screen or a console error.

Register both of these:

```
https://air-ltd.github.io/personal-time-tracker/

http://localhost:5173/
```

The first is derived from this repository's git remote
(`github.com/air-ltd/personal-time-tracker`) and is the URL the app will be served
from once Phase 1 deploys. It does not work yet — nothing is deployed — but
registering it now means the OAuth config is correct from the first deployment and
does not need revisiting.

The second is for local development, where the URL is `http`, not `https`, and
includes a port. All three differences matter.

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
browser (0012 AR6). If you find yourself wanting to use the secret, that is the
signal something has gone wrong with the flow choice.

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

The default the implementation should use, assuming "My Dropbox" access from step 2:

```
/personal-time-tracker/data.json
```

If you chose App Folder access instead, it becomes relative to `/Apps/<app-name>/`,
so:

```
/data.json
```

Write down which one you chose and which path you are going with. The
implementation needs a single constant, and getting this wrong shows up as a
sync that silently succeeds while writing somewhere unexpected.

---

## 8. Confirm before implementing

- [ ] App exists, access type is **Scoped access**
- [ ] Scopes: content read, content write, metadata read, account info — plus
      metadata **write** if step 3 indicates it is needed for conditional updates
- [ ] Redirect URIs registered: deployed Pages URL, and `http://localhost:5173/`
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

### Verify against Dropbox's documentation during implementation

[0012 SY10](../SPECS/0012-sync.md) already requires this. Confirm specifically:

- PKCE is supported for the authorization code flow, and whether a refresh token
  is issued for a public client
- The exact conditional-update mechanism for detecting concurrent writes, and
  which scope it needs
- Whether revisions come from a metadata read or the write response
- Rate limit behaviour, to size the retry and backoff in 0012 C5

None of these should be taken from this file or from the specs. They are
provider-specific and change without notice.
