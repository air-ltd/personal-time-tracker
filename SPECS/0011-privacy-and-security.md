# 0011 — Privacy and security

**Status:** `Draft`
**Depends on:** 0002
**Amends**: the original "no network calls" stance, superseded by 0012

## What changed

The original position was that data never leaves the browser. Cross-device sync
(0012) makes that impossible while keeping the app serverless. The guarantee is
now narrower and still strong:

> Data stays in the user's browser, except for a single JSON file in the cloud
> provider account the user explicitly connected. Nothing is sent anywhere else,
> and nothing is sent unless the user turned sync on.

This spec is the record of that trade-off, not an attempt to argue it away.

## No third parties

**P1** — The app MUST NOT load any asset from a third-party origin. No CDN
scripts, no Google Fonts, no CDN-hosted chart library, no unpkg.

**P2** — Fonts MUST be self-hosted or use a system font stack. A font fetch leaks
an IP address on every page load, which for a tool holding personal work history
is a tracking concern in its own right.

**P3** — The app MUST NOT include analytics, telemetry, error reporting or
session replay of any kind. There is no code path that sends usage data.

**P4** — There MUST be no third-party cookies, no trackers, no fingerprinting. The
app sets no cookies at all.

**P5** — All third-party runtime dependencies SHOULD be avoided in favour of
first-party ones. Every dependency is code executing in the context of the user's
data.

**P6** — These MUST be verifiable. The 0009 deployment checklist includes
confirming no request goes to an unexpected origin.

## Network policy

**N1** — Permitted outbound requests are exactly:
- The connected sync provider's API, and only while sync is enabled (0012).
- Nothing else.

**N2** — Sync MUST be opt-in. It MUST be off until the user completes
authorisation. No pre-connect, no background handshake on first run.

**N3** — The user MUST be able to disconnect the provider at any time. After
disconnecting, the app MUST make no further requests, and MUST NOT delete local
data.

**N4** — The app MUST remain fully functional offline (0002 O-1). No feature may
require the network.

**N5** — A Content Security Policy MUST restrict `connect-src` to the provider's
origin and nothing else, so an accidental dependency or injected script cannot
exfiltrate the whole database to a third party. This is the single most valuable
defence in this app, because the database is the whole asset.

**N6** — Any future feature that fetches *public* data the user requests — the
official holiday import deferred in 0013, for instance — MUST add that specific
origin to `connect-src` explicitly. It MUST NOT relax the policy, and MUST NOT send
any user data with the request.

## Data at rest

**R1** — Local IndexedDB data is stored unencrypted, relying on the operating
system and browser profile protections. This is a deliberate performance
trade-off: per-read key derivation would slow every report.

**R2** — The remote sync file is also unencrypted by the app, relying on the
provider's own encryption at rest and access control. See §Accepted risks.

**R3** — Sync tokens MUST be stored in IndexedDB, never in `localStorage`, never
in a cookie readable by script beyond what is needed, and never in the export
(0012 AU5, AU6).

**R4** — The app MUST NOT write *user data* to localStorage, sessionStorage or
the Clipboard without an explicit user action. No "copy my timesheet to clipboard
on every save" behaviour.

**R5** — One narrow exception is permitted for **non-sensitive UI preferences**:
the theme key in `localStorage`, used solely so the theme can be applied before
first paint (0002 TH4). It contains no personal data, is not authoritative, and
is reconstructible if lost. The set of allowed localStorage keys MUST be an
explicit allowlist, so this cannot quietly become a back door around R4.

## Non-working day labels

Introduced by 0013, checked here because it is the one field category that could
have raised a concern.

**LV-PRIVACY-1** — `NonWorkingDay.label` is free text (0003 NW1). A label such as
"sick" is health-adjacent, and in the plaintext sync file (R2, 0008 S3) it is
legible to the provider and to anyone with read access to the account.

**LV-PRIVACY-2** — This is accepted, and no app-level control is required for it.
The reasoning: the user chose free text deliberately and states there is no privacy
concern with it, and the app adds no disclosure of its own. A fixed type enum would
have been the actual privacy problem — it would force a real reason into a
constrained vocabulary, which makes the sensitive data more legible by giving it
structure, not less.

**LV-PRIVACY-3** — The app MUST NOT add a warning about label content. It stores
what the user writes and reports on it as data. Privacy theatre here would be
patronising and would not reduce exposure.

**LV-PRIVACY-4** — Should the plaintext risk (AR1, AR2) ever become unacceptable,
client-side encryption of the sync blob (E1) covers labels automatically. No
separate control is warranted for this field.

## Threat model

What this app is actually exposed to:

| Threat | Realistic? | Mitigation |
| --- | --- | --- |
| Shared or borrowed device | Yes | Entries are readable by anyone with browser access. No app-level protection; this is the platform's model. |
| Compromised provider account | Yes | Accepted risk, see below |
| Malicious dependency | Low | Small, pinned, audited dependency set (0005 P3 equivalent) |
| XSS reading the database | Low but high impact | React escapes by default; CSP `connect-src` blocks exfiltration; no `dangerouslySetInnerHTML` |
| CSRF against the provider | Low | Provider OAuth with PKCE; no cookie session to ride |
| Lost device | Yes | Encrypted by the OS if the device is; provider account revocable |
| Server-side breach | Not applicable | There is no server |
| This app going offline forever | Real | The data is a plain JSON file the user can keep. See 0012 FL2 |

**T1** — The app MUST NOT use `dangerouslySetInnerHTML`, `eval`, or
`new Function`. There is no legitimate need and each is a data-exfiltration
vector.

**T2** — The app MUST NOT read or write data for origins other than its own.

## Accepted risks

Recorded explicitly, because a privacy claim that hides its costs is not a
privacy claim.

**AR1 — The provider can read the data.** A single plaintext JSON file in a
commercial cloud account means the provider could access it under a court order
or a service change. The user accepted provider-side encryption only, over the
option of client-side AES-GCM encryption. This is a considered choice, not an
oversight.

**AR2 — Compromise of the provider account exposes the data.** With no
app-level passphrase, a stolen provider password yields the full work history.
The mitigations that exist are provider-side: strong unique passwords, two-factor
authentication, and app-specific authorisation where the provider supports it.
The app MUST document this in its settings screen rather than leaving the user to
assume encryption they do not have.

**AR3 — The remote file is a single point of failure.** One file, one account. It
can be deleted. Sync is replication, not backup (0007 FB-7), which is why local
export nudging continues regardless of whether sync is enabled.

**AR4 — Anyone with read access to the file sees the raw data.** Its schema is
plaintext and self-describing. If the remote file were ever shared — a shared
Dropbox folder, an emailed backup — the contents are legible.

**AR5 — There is no app-level authentication.** The app itself is a public static
site. It has no access control, so the only thing protecting the data is the
device's browser profile.

**AR6 — Embedded OAuth client ids are public.** Expected under PKCE, harmless on
its own (0012 AU3), and noted so nobody later "fixes" it by introducing a client
secret that cannot be safely embedded in a static site.

## Reconsidering encryption

**E1** — If AR1 or AR2 stops being acceptable, client-side encryption is the
change: AES-GCM with a PBKDF2-derived key over the remote blob only, leaving
local storage plaintext. The cost is a passphrase the user must not lose, since a
lost passphrase means a lost remote copy.

**E2** — The sync envelope (0008) MUST be structured so the payload is a
substitutable field. Encrypting it should be an additive change to the transport
layer, not a schema rewrite.
