# Code Review — `personal-time-tracker`

**Reviewed:** `e5de0ed` — the whole repository, clean tree.

> Note on timing: the About page, `CHANGELOG.md` and `docs/RELEASING.md` were
> uncommitted work-in-progress when this review started and were committed as
> `e5de0ed` partway through it; they are reviewed in their committed form
> ([§10.4](#104-the-about-page-and-changelog-e5de0ed)). A CSP plugin was then
> started in `vite.config.ts` in response to [§6.1](#61-high--there-is-no-content-security-policy-anywhere-_being-fixed-see-the-note-below_);
> that finding is annotated accordingly rather than withdrawn.

**Requested inputs:** `./review/code_review_response.md` does **not exist** in this
repo and was not available, so this review is a first-hand review of the code. A
previous review by another agent exists at `specs/review.md`; its 25 findings were
re-verified against the current code and their status is reported in
[§9](#9-status-of-the-previous-review-specsreviewmd).

---

## 1. Method and verification

**Read in full:** every file in `src/` (11,873 lines of application code, 10,425 of
tests), all 14 files in `SPECS/`, `SPECS/todo.md`, `README.md`, `CHANGELOG.md`,
`docs/dropbox-app-setup.md`, `docs/RELEASING.md`, `e2e/smoke.mjs`,
`scripts/check-silent-failures.mjs`, `scripts/run.sh`, every config file
(`package.json`, `tsconfig*.json`, `vite.config.ts`, `eslint.config.js`,
`.prettierrc.json`, `.prettierignore`, `.github/workflows/deploy.yml`,
`.devcontainer/`, `index.html`, `.env.example`).

**Executed, not assumed:**

| Check                                               | Result                                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                 | pass                                                                                                                 |
| `npm run lint`                                      | pass                                                                                                                 |
| `npm test`                                          | **725 tests / 43 files, all pass**                                                                                   |
| `npm run build`                                     | pass — 527.55 kB raw / **159.77 kB gzip**                                                                            |
| `node scripts/check-silent-failures.mjs`            | **11/11 mutations caught**                                                                                           |
| `npx prettier --check .`                            | pass                                                                                                                 |
| Contrast measurement of every hard-coded CSS colour | computed with the repo's own WCAG maths, results in [§5.7](#57-hard-coded-sync-indicator-colours-one-fails-contrast) |

**Automated sweeps run against the source:**

- a requirement-ID resolver that extracts every `NNNN XX` citation from
  `src/`, `e2e/`, `scripts/`, `docs/`, `index.html`, `vite.config.ts` and checks
  it against the IDs actually defined in `SPECS/` (results in [§10.2](#102-citation-drift));
- an unused-export detector over `src/` (results in [§5.6](#56-dead-and-speculative-code));
- a duplicated-CSS-selector scan.

---

## 2. Verdict

This is unusually disciplined code. The architecture matches the spec it was built
from, the domain layer really is pure, and the test culture — unit, integration,
property, multi-device convergence, browser smoke, and a mutation gate that proves
the suite would notice — is better than most projects manage. Comments explain
_why_ far more often than _what_, and they are usually right.

The findings below are mostly **gaps between an already-written specification and
the code**, not defects of judgement. That is a good problem to have, but several
of the gaps are silent (a sync trigger that never fires, an empty currency list
that empties every picker, a spec that says "clear the list to get everything back"
and does the opposite), which is exactly the class of bug this project's own
mutation gate exists to catch. **Four of them are worth fixing before the next
push**; the rest can be batched.

| #   | Area                    | Verdict                                                                                               |
| --- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | Comments explain _what_ | **Yes**, mostly by naming rather than narrating. A few restate the code.                              |
| 2   | Comments explain _why_  | **Yes, and unusually well.** One comment now contradicts the code; four JSDoc blocks are duplicated.  |
| 3   | Code smells             | **A dozen, all small.** Duplicated JSDoc, duplicated CSS rules, dead exports, one layering inversion. |
| 4   | Security                | **One real gap: no CSP** (a MUST in 0011) — fix in progress in the tree. Otherwise sound.             |
| 5   | Spec ↔ code consistency | **High for implemented scope**, with 10 documented divergences and 10 unresolvable spec citations.    |
| 6   | Performance             | **Fine at the confirmed volume.** Two avoidable O(components × tables) read patterns.                 |
| 7   | Potential bugs          | **Three high, two medium**, and four of the five are silent.                                          |

---

## 3. Are there enough and relevant comments explaining _what_ the code does?

**Yes — and mostly by naming rather than narrating, which is the better technique.**
The codebase rarely writes `// increment i`; it names things well enough that the
code reads as prose (`id`, `orphanedEntryIds`, `queuedWhileRunning`,
`IN_FLIGHT`, `duplicates`, `keepBoth`) and then explains the non-obvious decision.

Weak spots, all minor:

- `src/styles.css` is the least-documented file. Several sections are commentless
  and, where rules exist, they were left behind by duplication rather than by
  intent ([§5.5](#55-css-sprout-and-undefined-tokens)).
- `src/features/taxonomy/TaxonomySettings.tsx` is 1,001 lines and the
  `ClientSection` / `ProjectSection` / `TagSection` bodies carry almost no prose
  beyond the file header. The header explains _why the panel exists_, which is the
  important part; the individual delete/undo paths are legible but undocumented.
- `src/domain/entries/validate.ts` and `src/features/entries/EntryForm.tsx` are
  effectively comment-free and rely on being obvious. That is a defensible choice,
  and `validate.ts`'s header earns it.
- Two places where a comment describes code that has since changed:
  - `src/domain/taxonomy/names.ts:11-16` — "Deliberately **not** Unicode-normalised"
    while `:19` calls `.normalize('NFC')`. The comment is wrong and its reasoning
    ("NFC and NFD forms … would compare unequal here") is the argument _for_
    normalising. See [§5.1](#51-a-comment-that-contradicts-the-code).
  - `src/sync/engine.ts:131-134` — "Ordering matters less than it used to:
    `repairReferences` no longer edits in place … It still goes first, because
    there is no reason to write records we already know are wrong." Accurate, but
    layered on top of three other paragraphs explaining the same history.

**Verdict: no action needed beyond fixing the one wrong comment.**

---

## 4. Are there enough and relevant comments explaining _why_ the code does what it does?

**Yes. This is the strongest dimension of the review.** The project has a house
style — state the decision, the requirement ID, and the failure it prevents — and
it is applied consistently. Examples that genuinely made this review faster:

- `src/domain/merge.ts:35-43` explains why `JSON.stringify` cannot be used for the
  tiebreak (key insertion order differs between devices, so two devices pick
  different winners and never converge).
- `src/storage/snapshotRepo.ts:75-88` explains why `bulkPut`'s upsert semantics
  are _safer_ than a clear-then-write, including the hostile-snapshot case.
- `src/sync/dropbox/config.ts:40-52` records the `WriteMode` union asymmetry with
  the exact Dropbox error string it produces if you get it wrong.
- `src/features/timer/TimerPanel.tsx:328-342` documents a real ordering bug (Start
  clickable before the async default-project read resolved) that had filed a
  client's time as uncategorised with no trace.
- `src/domain/taxonomy/money.ts:5-8` states outright that the resolution order
  _is_ the rule and is therefore written out longhand rather than generalised.
- The `todo.md` "Notes worth keeping" section is effectively a comment log for the
  whole project.

Weak spots:

- **Three duplicated JSDoc blocks**, all the residue of an edit that added a new
  paragraph instead of replacing the old one. The first copy is now orphaned and,
  in two cases, documents a signature that no longer exists:
  - `src/domain/merge.ts:127-134` and `:135-147` — two doc comments on
    `repairReferences`.
  - `src/storage/entriesRepo.ts:99-104` and `:105-112` — the first documents
    `startTimer` "Guarded so a second start cannot create a second running entry",
    which the second (correct) comment supersedes.
  - `src/storage/taxonomyRepo.ts:289-295` — a doc comment for `createTag` that is
    followed by a _different_ doc comment, so the first is attached to nothing.
- **Reasoning is repeated where a single note would do.** `TimerPanel`'s
  "awaited before navigating" rationale appears in the prop doc
  (`TimerPanel.tsx:24-31`), again at the call site (`:240-246`), and again in
  `App.tsx`'s `onStopped`. Three copies of one decision is one copy too many, and
  they can drift.
- **Some comments record decisions that were later reversed without being pruned**
  — e.g. `appKey.ts:82-98` explains at length why a browser-stored key is ignored,
  which is correct and useful, but sits beside `clearAppKey`/`hasLegacyStoredKey`
  that exist purely to clean up after a design that no longer applies.

**Verdict: strong. Prune the duplicates and fix the wrong comment; do not add more.**

---

## 5. Code smells

### 5.1 A comment that contradicts the code

`src/domain/taxonomy/names.ts:11-19`

```
/**
 * Trimmed and lowercased. Deliberately not Unicode-normalised: NFC and NFD forms of the
 * same accented character would compare unequal here, so "café" typed two ways could
 * both be created. Normalising means a name round-tripped through a backup — where
 * decomposition can differ — still compares equal to itself.
 */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().normalize('NFC')
}
```

The comment says "not Unicode-normalised" and then argues for normalisation; the
code normalises. The _behaviour_ is right (normalising is the correct choice for a
name compared across devices and across a backup round-trip); the _comment_ is the
opposite of the code. This is the most damaging kind of comment defect, because a
future reader who trusts it will "fix" correct code.

### 5.2 Render-phase side effect in `TaxonomySettings`

`src/features/taxonomy/TaxonomySettings.tsx:76-82`

```tsx
const [loadedCurrency, setLoadedCurrency] = useState(false)
if (!loadedCurrency) {
  setLoadedCurrency(true)
  void readDefaultCurrency().then(setDefaultCurrency)
}
```

A storage read is started during render. React's documented pattern for this shape
only allows a `setState` during render; an async read is a side effect and will be
re-issued under `StrictMode`'s double-invoked render (which the app enables in
`main.tsx`). The read is idempotent so the practical damage is one wasted read, but
the pattern is wrong and the "set a flag to guard a read" idiom here is a code smell
wherever else it appears. `useEffect` + a `cancelled` flag is the house style used
in every other hook in this repo (`useEntryPeriod.ts`, `useVisibleCurrencies.ts`,
`ClientForm.tsx`) and should be used here too.

### 5.3 Three currency fallbacks where the spec defines one

`src/domain/taxonomy/money.ts:51-70` implements the 0003 resolution chain
(project → client → app default → `USD`) as `resolveCurrency()`. Nothing calls it.
Instead the resolution is re-implemented inline, three times, with three different
answers:

| Site                       | Code                                                                                                                               | Consequence                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `EntryForm.tsx:167-176`    | `effectiveCurrency = project?.currency ?? client?.currency ?? null`, then `formatMinor(effectiveRate, effectiveCurrency ?? 'USD')` | hard-coded `USD`, and the app-wide default currency setting is **ignored** |
| `TaxonomySettings.tsx:470` | `const effectiveCurrency = currency ?? client?.currency ?? 'GBP'`                                                                  | hard-coded `GBP`                                                           |
| `TaxonomySettings.tsx:623` | same expression again                                                                                                              | hard-coded `GBP`                                                           |

So the rate preview in the entry form can say `£` about a rate that will be billed
in `JPY`, and it ignores the very setting the user configured on the settings page
one screen away. Fix is one line each: `resolveCurrency(project, client, appDefault)`.

### 5.4 Layering inversion: `storage/` imports from `sync/dropbox/`

`src/storage/secretsRepo.ts:2`

```ts
import type { DropboxTokens, DropboxTokenStore } from '../sync/dropbox/DropboxProvider'
```

The storage layer's token table is typed by a Dropbox implementation module. 0002
A5 only forbids `domain/ → sync/`, so this is not a literal rule violation, but it
inverts the intended dependency: 0012 SY6/SY9 exist precisely so a second provider
can be added without touching anything else, and this line makes adding one mean
editing `storage/`. The token store should be a generic `{ read, write, clear }`
over an opaque `unknown`, with the Dropbox shape narrowed in the provider — the
parsing in `toTokens()` (`secretsRepo.ts:21-31`) already does exactly that and
could move.

### 5.5 CSS sprout and undefined tokens

`src/styles.css:884-906` declares `.entry-edit` **four times in thirteen lines**,
splitting `position`, `color` (declared twice, the later winning) and `background`
across separate rules, plus twice more inside the `@media (max-width: 34rem)` block
(`:1371-1383`). The result is correct but the cascade now depends on rule order for
no reason.

Related token problems, same file:

- `--surface-2` is referenced five times (`589`, `688`, `692`, `875`, `901`, `1354`)
  and **never defined**, so every use silently falls back to a literal
  `rgb(127 127 127 / …)`.
- `--danger` is defined only under `:root[data-theme='dark']` (`:233`); the light
  theme relies on the inline fallback `#b3261e` at `:228-229` and `:939-940`.
  Measured, both are fine (6.32:1 light, 9.9:1 dark), so this is tidiness, not
  accessibility.

### 5.6 Dead and speculative code

Unused anywhere in `src/`, `e2e/` or the app:

| Export                                                      | Note                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CloudIcon` (`src/app/Icons.tsx:67`)                        | **Rendered nowhere.** `SyncIndicator` draws a `sync-indicator-dot` and `SyncPanel`'s Connect button is text-only. `SPECS/todo.md` item 17 claims "a cloud is now drawn inline" for the Connect Dropbox control — the icon exists, the UI does not use it. |
| `formatDayHeading` (`src/domain/time/duration.ts:91`)       | No caller, and no test.                                                                                                                                                                                                                                   |
| `draftFrom` (`src/domain/entries/validate.ts:117`)          | No caller, no test. A pass-through `{ start, end, note }`.                                                                                                                                                                                                |
| `isValidAppKey` (`src/sync/appKey.ts:73`)                   | Only tests use it. Existed for the in-browser key entry that was removed.                                                                                                                                                                                 |
| `matchRoute` (`src/app/router.ts:47`)                       | Superseded by `matchPath`; tests exercise it, the app does not.                                                                                                                                                                                           |
| `TaxonomyOption`, `TaxonomyEntity`, `PaletteColour` (types) | Declared, never referenced.                                                                                                                                                                                                                               |

A further group — `weekKey`, `dayKeysInRange`, `localDayLengthMs`, `countRecords`,
`sortEntriesForList`, `resolveRateMinor`, `resolveCurrency`, `groupByCurrency`,
`projectDefaultsToBillable`, `findByName`, `listDeletedEntries`, `perceptualDistance`
— is production-unused but each is a Phase 5/6 requirement with tests. That is a
deliberate pure-domain-ahead-of-UI choice and I would keep it; it should be stated
once in the domain package README so a future reader does not "clean it up".

Genuinely redundant: `src/storage/snapshotRepo.ts:127` re-exports
`export type { TimeEntry }`, which nothing imports.

### 5.7 Hard-coded sync-indicator colours; one fails contrast

`src/styles.css:779-789` — three literal hex colours where every other colour in the
file is a token (0002 TH3 says components MUST NOT hard-code colours):

| Selector                | Colour    | vs light `--bg` | vs dark `--bg` |
| ----------------------- | --------- | --------------- | -------------- |
| `.sync-indicator-ok`    | `#2e8b57` | 4.11:1          | 4.33:1         |
| `.sync-indicator-warn`  | `#c98a12` | **2.85:1**      | 6.24:1         |
| `.sync-indicator-error` | `#c0392b` | 5.26:1          | 3.38:1         |

(Computed with the repo's own `luminance`/`contrastRatio`.)

`#c98a12` at 2.85:1 is below WCAG 2.2 SC 1.4.11's 3:1 for meaningful non-text
content, and below this project's own bar — `MIN_CHART_CONTRAST = 3` in
`domain/taxonomy/colour.ts:135`, which the palette test suite enforces for every
project colour. The dot is not the sole carrier of meaning (the button has a text
label), which caps the severity, but it is a status indicator that fails the
standard the project holds everything else to, and the fix is three tokens.

### 5.8 The dynamic import that does nothing

`src/sync/oauthCallback.ts:54` dynamically imports `./providerFactory`, and
`SyncProvider.tsx:4` imports it statically. Vite says so at build time:

```
INEFFECTIVE_DYNAMIC_IMPORT  src/sync/providerFactory.ts is dynamically imported by
src/sync/oauthCallback.ts but also statically imported by src/features/sync/SyncProvider.tsx
```

The intent (defer work until the redirect is actually handled) is sound and the
"do not await the callback" decision is correct; the `await import()` itself just
adds an indentation and a build warning.

### 5.9 Smaller smells

- `src/sync/engine.test.ts:63-69` — `FakeProvider.status()` still returns an
  `account` field that `ProviderStatus` no longer declares. It type-checks only
  because freshness is lost through `Promise.resolve`, so it also demonstrates that
  the double-boundary cast pattern hides excess-property errors.
- `src/features/taxonomy/ColorPicker.tsx:85,91` — `PALETTE.includes(normalised as never)`
  twice. `as never` defeats the literal-tuple type it is working around;
  `new Set<string>(PALETTE).has(normalised)` or `.some(c => c === normalised)`
  needs no cast.
- `scripts/run.sh:5` — contains a stray `### End of File` marker inside a POSIX
  shell script.
- `src/features/settings/SettingsPage.tsx:43-48` renders a visually-hidden
  `<h2>Currencies</h2>` immediately above `CurrencyPreferences`' own
  `<h3>Currencies</h3>`, so the accessibility tree has two headings with the same
  name in the same card.
- `src/app/ThemeToggle.tsx:24` builds static ids (`theme-light`). Harmless today
  because there is exactly one instance; it becomes a duplicate-id bug the moment
  there are two.
- **One host name is still baked in.** `appKey.ts:28` hard-codes
  `PRODUCTION_HOSTS = ['air-ltd.github.io']` and `redirect.ts:37` hard-codes
  `DEPLOYED_ORIGIN`. The second is display-only and documented as such, so it is
  fine. The first decides **which Dropbox app is used**, so it is behavioural: a
  fork, a custom domain, or a renamed Pages site silently falls through to the
  _non-production_ Dropbox app — a different app folder, so a fork's "production"
  data would land somewhere the user is not looking at. Deriving it from
  `import.meta.env.PROD` would not help (that is true in `vite preview` too, which
  `appKey.ts:22-27` correctly calls out), but a build-time variable or a
  host-to-environment map in `vite.config.ts` would.
- `SPECS/` and `specs/` are two directories differing only in case. On a
  case-insensitive filesystem (macOS) these merge; on Linux they do not. `specs/`
  holds only the previous review. Rename to `docs/reviews/` before that bites.

---

## 6. Security issues

### 6.1 HIGH — There is no Content Security Policy anywhere _(being fixed; see the note below)_

`0011 N5` is unambiguous:

> **N5** — A Content Security Policy MUST restrict `connect-src` to the provider's
> origin and nothing else, so an accidental dependency or injected script cannot
> exfiltrate the whole database to a third party. **This is the single most valuable
> defence in this app, because the database is the whole asset.**

There is none. Not in `index.html`, not in `public/`, not in `dist/index.html`, not
in the Pages workflow (GitHub Pages cannot set response headers, so a
`<meta http-equiv>` policy in `index.html` is the only available route — and
`404.html` is a copy of `index.html`, so one insertion covers both).

This matters more than a normal missing-header finding, because this app's entire
asset is a local database of work history. The two things that would stop a script
from shipping it off-site are React's escaping (present, and used — no
`dangerouslySetInnerHTML`, no `eval`, no `new Function` anywhere in `src/`, and
`AboutPage.tsx` renders the changelog through React nodes specifically for that
reason) and the `connect-src` allowlist (absent). With no CSP, one bad dependency
update or one injected string gets a working exfiltration channel.

The related documentation is worse than the omission: `0011`'s own threat table
lists "CSP `connect-src` blocks exfiltration" as a **current** mitigation for
"XSS reading the database". That claim is false today.

This is a _scheduled_ gap, not an oversight — `0014` Phase 8 lists "CSP finalised"
with the same requirement ID. The finding is that the threat model already counts
the mitigation as banked, so nothing will flag it until Phase 8. Concretely:

```html
<meta
  http-equiv="Content-Security-Policy"
  content="
  default-src 'self';
  connect-src 'self' https://api.dropboxapi.com https://content.dropboxapi.com;
  img-src 'self' data:;
  style-src 'self' 'unsafe-inline';
  script-src 'self' 'unsafe-inline';
  object-src 'none';
  base-uri 'none';
  frame-ancestors 'none';
  form-action 'none';
"
/>
```

Two honest caveats about that policy, because getting them wrong makes it worse
than no policy:

- **`'unsafe-inline'` in `script-src` is required as written**, and it is a real
  weakening. `index.html` carries an inline `<script>` (the pre-paint theme
  bootstrap, `index.html:26-43`) which `script-src 'self'` would block outright —
  the page would still render, but the theme would flash and the bootstrap's
  `try/catch` guarantee would be gone. The fix is to move those 17 lines into
  `src/theme-bootstrap.ts` and reference it with a `<script type="module" src>`;
  Vite then emits a hashed file and `'self'` alone suffices. Worth doing in the
  same change, because a policy that needs `unsafe-inline` in `script-src` still
  blocks nothing an XSS payload needs for its _exfiltration_ step.
- **`'unsafe-inline'` in `style-src` is unavoidable** as long as colours are set
  through `style={{...}}` attributes (`ColorPicker.tsx:56`, `EntryList.tsx:146`,
  `TaxonomySettings.tsx:699`). This is the low-risk half; it does not enable
  script execution.

The part that carries the actual protection is `connect-src`, and that can be
strict from the first commit: two Dropbox origins and `'self'`, nothing else. That
is precisely the guarantee 0011 N5 asks for, and it is the one that makes a stolen
copy of the database undeliverable.

**Status update — a fix appeared in the working tree while this review was being
written.** `vite.config.ts` now carries a `content-security-policy` plugin that
injects the policy at build time. I checked it, and it is better than the version
above:

- the inline theme bootstrap is allow-listed by **content hash** computed from the
  emitted HTML, rather than by `'unsafe-inline'` in `script-src` — so a policy
  strict enough to be worth having does not become a no-op, and the hash cannot
  drift from the script it describes;
- it is injected at build time, so the Vite dev server's own inline preamble does
  not force a weakened policy during development;
- `frame-ancestors` is deliberately omitted, with the reason given (a `<meta>`
  policy is silently ignored for that directive) rather than included as
  protection that does not exist;
- the two `connect-src` origins are duplicated from `sync/dropbox/config.ts` with
  the trade-off stated, and an e2e assertion is intended to keep the two in step.

Verified: `npm run build` succeeds, `dist/index.html` and `dist/404.html` both carry
the policy, and 725 tests still pass.

What remains open on this item, and is what the finding now reduces to:

- the plugin and the e2e assertion are not yet committed, so the finding stands
  against `e5de0ed`;
- nothing asserts that the hash matches the bootstrap, so a future edit to
  `index.html`'s inline script silently produces a CSP that blocks it — the page
  still renders, but the pre-paint theme is gone (0002 TH4, AC10) with no test
  failing. A build-time assertion or a `smoke.mjs` check that the served hash
  allow-list is non-empty would close that;
- `0011`'s threat-model row still lists CSP as a current mitigation, which becomes
  true only once this lands.

### 6.2 What is right about the security posture

This deserves stating, because it is the part most projects get wrong:

- **Token hygiene.** Tokens live in their own IndexedDB table, excluded from
  snapshots _structurally_ — `snapshotRepo.TABLES` simply does not name it
  (`snapshotRepo.ts:29`, `:43-45`) rather than filtering at write time. The
  `token-in-export` mutation in `check-silent-failures.mjs` proves the suite
  notices if that ever inverts.
- **PKCE done properly.** Verifier in `sessionStorage` (never `localStorage`),
  single-use, cleared on redemption, 10-minute expiry
  (`DropboxProvider.ts:56-77`, `:217-270`). `state` is verified and a mismatch
  discards the pending record (`:170-174`).
- **Defensive token parsing.** `toTokens()` treats the stored value as untrusted
  and returns `null` on any shape mismatch, so a record written by another build
  becomes "not connected" rather than a crash.
- **No token leakage in errors.** `describeFailure()` builds its message from
  `args`, `error_summary` and the response body — never from the `Authorization`
  header (`DropboxProvider.ts:388-464`). `oauthCallback.ts` logs the error
  description and stores a message in `sessionStorage`, not a code or token.
- **Least privilege.** Exactly two scopes, no refresh token, no account-info scope;
  the app-folder path and `.tag: 'update'` union shape are recorded with the
  vendor-spec citation that produced them.
- **`localStorage` allowlist honoured.** Only `tt:theme` is written;
  `tt:dropbox-app-key` is now read-only-and-ignored, and `sessionStorage` holds only
  the PKCE pending record and the auth error — exactly 0011 R5/R7.
- **OAuth client ids treated honestly as public**, with an explicit warning in
  `.env.example` never to put the app secret in a `VITE_` variable, and `0011 AR6`
  recording why so nobody "fixes" it later.

### 6.3 Low — token is discarded on a rejected write, silently

`scheduler.ts:222-238` calls `provider.signOut()` on any `auth`- or
`scope-missing`-kind failure. The reasoning is documented and mostly sound (the
token is provably unusable), but `scope-missing` in particular is often a _console_
misconfiguration rather than a bad token, and the user's only clue is that the
Connect button reappears. `DropboxSetup` does display the required scopes and the
exact redirect URI, which covers it; a sentence in the disconnect path pointing at
those two would close the loop.

### 6.4 Low — build-time secrets footgun

`.env.example` warns that `VITE_*` is bundled. Nothing enforces it: `VITE_DROPBOX_APP_KEY`
is the only `VITE_` variable, and there is no guard against someone adding
`VITE_DROPBOX_APP_SECRET`. A grep-based check in `check-silent-failures.mjs` or a
`verify` step would make the warning enforceable rather than advisory.

---

## 7. Performance

At the confirmed volume (`0006` — under ~100 entries/week, a few thousand total)
nothing here is slow, and I found no algorithmic problem. `groupEntriesByDay` and
`summariseEntries` are linear; `bucketMsByDay` walks days rather than milliseconds;
`dayKey`/`localDayBounds` construct from local components, which is both the DST
fix and cheap. `suggestColour` is O(palette × used) = 144 contrast computations,
called once per project creation.

Two avoidable patterns, both from the same root cause (no shared read context):

1. **`useEntries()` is mounted twice on the home screen.** `EntriesView.tsx:30`
   subscribes, and `EntryList.tsx:31` subscribes again even when the caller already
   passed `entries` in (`EntryList.tsx:26-33`). Every write therefore triggers two
   full `entries.toArray()` + filter + sort cycles. The second subscription is dead
   weight — the component uses `stored` only when `provided` is undefined.
2. **`useTaxonomy()` is mounted in five components** (`EntriesView`,
   `EntryList`, `EntryForm`, `TimerPanel`, `TaxonomySettings`). Each bump re-reads
   `projects`, `clients` and `tags` in full — three table scans per subscriber per
   revision. One `writeSnapshot` or `mergeTags` is 15 full-table reads.

Both are invisible at a few thousand rows and both get worse linearly with feature
count. The fix is one `TaxonomyProvider`/`EntriesProvider` at the app root, which
also removes the duplicated `projectById` map construction in four files. Worth
doing before Phase 5 adds a reports view that also needs both.

**Bundle:** 527.55 kB raw / **159.77 kB gzip**. 0002 CH6 sets a ~250 kB gzip
trip-wire; the app is at 64% of it with reports and charts still to come, so this
is a number to keep watching — and it is currently only ever measured by hand.
A `size-limit` check in CI would make CH6 enforceable.

**One wasteful render:** `App.tsx` re-renders every 30s (`CLOCK_MS`) to advance
elapsed displays. That is correct and cheap, but it re-runs `groupEntriesByDay` on
every tick because `now` is a dependency. Memoising on `[entries, now]` would
trade a 30-second-interval recomputation for nothing measurable — mentioned only so
it is a decision rather than an accident.

---

## 8. Potential bugs

Ordered by how much damage they do to the user.

### 8.1 HIGH — Saving an empty currency selection empties every currency picker

`src/features/taxonomy/CurrencyPreferences.tsx`

The panel's own instruction says:

> "Clear the list, or leave nothing ticked, to go back to the full ISO 4217 list."

The Save handler does:

```tsx
onClick={() => set(chosen.size === all.length ? null : [...chosen])}   // :184
```

and `CurrencySelect` filters on:

```tsx
const options =
  visible === null
    ? all
    : all.filter((option) => visible.includes(option.code) || option.code === value) // :53-56
```

So the sequence _pick GBP → Save → Clear selection → Save_ stores `[]`, which is
**not** `null`, which leaves every currency picker in the app offering exactly one
option: whatever that record already has. The "Offer every currency" button beside
it does the right thing, so the state is recoverable — but it is not what the
on-screen text promises, and it is reached by following the instructions exactly.
Either map an empty selection to `null` on save, or change the copy to say what
empty actually means. (`readVisibleCurrencies`'s own doc comment at
`settingsRepo.ts:69-70` explicitly distinguishes null from empty for exactly this
reason, so the intent is documented — the save path just does not honour it.)

No test covers this path.

### 8.2 HIGH — A running entry cannot be edited without retyping its duration

`src/features/entries/EntryForm.tsx:50-57`

```tsx
const [durationValue, setDurationValue] = useState(() =>
  entry && entry.end !== null ? toDurationInputValue(/* … */) : '',
)
const [endValue, setEndValue] = useState(() =>
  entry && entry.end !== null ? toLocalInputValue(new Date(entry.end)) : '',
)
```

For a running entry (`end === null`) both fields start empty, so `end` is `null`
(`:86-98`) and `onSubmit` bails with "Enter how long this took."
(`:105-128`). 0004 ED1 says _"Every entry MUST be editable after creation,
including a running one"_ and ED2 says editing `end` stops it — both are true
simultaneously only if the user is _able_ to edit. Today the only way to change a
running entry's note or project is to also state its duration, which stops it as a
side effect. A user who opens the pencil to fix a typo and presses Save gets a
validation error that looks like the app lost their note.

Fix: when `entry.end === null`, prefill the duration with `now - start` (or leave the
preview visible and submit `end: null` when the duration was untouched). No test
covers editing a running entry — 23 `EntryForm` tests, none of them this case.

### 8.3 HIGH — Sync never fires on a local write

`src/sync/scheduler.ts:178` — `schedule()` exists, debounces correctly, flushes on a
timer, and is fully tested (`scheduler.test.ts:176-194`). **Nothing in the app ever
calls it.** `SyncProvider.tsx:67-80` starts the scheduler when connected and never
subscribes to writes; `bumpRevision()` reaches `useEntries`, `useTaxonomy` and the
views, and nothing else.

Consequences, all of them contradicting requirements that the plan claims are done:

- 0012 **C1** — "Triggered on: app open, a local write (debounced), manual Sync now,
  returning to the tab, and `pagehide`." Only four of the five are wired.
- 0012 **C2** — the debounce/flush behaviour is unreachable in production.
- 0012 **C7** — "Only a _dirty_ local database SHOULD trigger a push" has nothing to
  observe.
- 0014 Phase 2B lists "Scheduler: app open, debounced writes, tab focus, `pagehide`,
  manual button" as delivered, and Phase 2B's status is "complete and committed".
- 0012 **C8** — "Sync status MUST be visible: last synced time, **pending changes**,
  error state." The panel shows the first and third; there is no pending indicator
  and no dirty flag anywhere.

Nothing is lost — the next `pagehide`, tab-focus or app-open picks the change up,
and the engine's content comparison means it publishes correctly. But on two devices
open side by side, work recorded on one is invisible on the other for the whole
session, and a user who closes a laptop lid rather than the tab (or whose tab is
discarded without `pagehide`) sits on unsynced local data for hours. Fix is small:
subscribe to the revision counter in `SyncProvider` and call `scheduler.schedule()`,
debounced, on change — the storage layer already emits the signal.

### 8.4 MEDIUM — Manual entries are allowed while a timer runs

0004 **M4** is a MUST with two clauses: _"A manual entry MUST NOT be created while a
timer is running. The UI MUST prompt to stop the timer first … The app MUST NOT
silently stop the running timer on the user's behalf."_

`App.tsx:175` renders `<EntryForm now={now} />` for `/entries/new` with no check,
and `EntryForm` never asks. `0004 M4` is listed under Phase 2A, and 0014 records
Phase 2A as "Status: complete. Full gate verified."

This does not break 0003 E4 (the manual entry has an `end`, so there is still only
one open-ended row), but the user can record a manual entry covering the exact
window a timer is running, and both are then counted in the day total per 0004 O2.
The overlap is visible, which is the specified behaviour for _accidental_ overlap
— but this path makes it easy to do by accident.

### 8.5 MEDIUM — The merge's conflict retry ignores writes made during the cycle

`src/sync/engine.ts:198-218`. On a push conflict the engine re-pulls, merges the
fresh remote with the **in-flight `snapshot`** (read at the top of the cycle), and
pushes that. An entry created while the network round-trip was in flight is not in
`local`, so it is neither merged nor pushed — it is only picked up on the next
cycle. No data loss (the write is in IndexedDB and the engine's `writeLocal` is an
upsert), but the "sync now" button can report success while omitting the entry the
user just added. A re-read of local data in that branch fixes it, at the cost of one
extra IndexedDB read on a path that is already the rare one.

### 8.6 LOW — Other smaller risks

- **`App.tsx:82-92`** — the edit route's load effect keys on `editId` only. If the
  entry changes underneath an open form (a sync merge, a taxonomy delete, an undo in
  another tab), the form keeps the stale record and a save will overwrite the newer
  one. Cheap fix: add the revision to the dependency list.
- **`e2e/smoke.mjs`** — `const BASE = '/personal-time-tracker/'` was hard-coded in
  the browser suite, which is the one file whose job is to prove the base path
  works. It would fail confusingly on a rename and would pass while proving nothing
  about a `VITE_BASE_PATH` override. **Being fixed in the working tree:** the base is
  now derived from the module script `href` in `dist/index.html`, read after the
  build, which is the right source of truth.
- **`scripts/check-silent-failures.mjs:160-168`** — any non-zero `vitest` exit counts
  as "caught". A mutation that only breaks module loading — a syntax error, or a
  `describe` block that throws at collection — is therefore reported as coverage it
  is not. It should assert the failure came from a _test_ (e.g. require
  `Tests 1 failed` in the output and `0 failed` at file level). All 11 current
  mutations are genuinely caught — I verified the run — but the gate's own claim is
  slightly stronger than what it proves.
- **`src/test/harness.ts:12-16`** — `installTestDb` creates a fresh database per
  test and never closes the previous one. 725 tests leave 725 open connections in
  `fake-indexeddb`; harmless today, a memory and flake risk at 2,000.
- **`envelope.ts:81,160-164`** — `counts` is validated but never cross-checked
  against the array lengths. 0008 J5 says counts "enable a cheap integrity check
  and let the importer confirm nothing was truncated in transit"; nothing does. Two
  lines in `parseEnvelope` would make J5 real and would catch a hand-edited or
  truncated file that still parses.

### 8.7 The changelog ships inside the JavaScript bundle

`src/app/AboutPage.tsx:2` imports `../../CHANGELOG.md?raw`, so the whole changelog is
inlined into the main chunk. Today that is 7 KB of a 527 kB bundle — invisible.
The problem is directional: the bundle grows by the size of the entire release
history, forever, for every user, and the release notes are the _least_ useful thing
to have cached in code. 0002 CH6 gives the project a 250 kB gzip trip-wire, and
0009 C4 already reasons about not shipping internals.

Not a bug and the decision is well argued in the commit message (one source of
truth, no `public/` copy to drift, works on a fork and offline). If it ever becomes
a measurable cost, the fix that keeps all three properties is to keep the file in
the repo, bundle it, and cap what is inlined — or to move it to `public/` at release
time with a generated copy and a test that the two match.

---

## 9. Status of the previous review (`specs/review.md`)

I re-verified all 25 findings against the current code. **All 25 are genuinely
fixed** — I checked each one at the cited location rather than trusting
`todo.md`'s "Fixed" list. Highlights:

| Prior finding                                | Current state                                                                                                                                                                                                                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `dexie` under `devDependencies`           | Fixed — `package.json:25`, now a runtime dep                                                                                                                                                                                                                                     |
| 2. `writeSnapshot` one transaction per table | Fixed — `snapshotRepo.ts:89-95`, single `db.transaction` across all tables, with a rollback test                                                                                                                                                                                 |
| 3. Navigate before `stop()` lands            | Fixed — `TimerPanel.tsx:240-246` awaits                                                                                                                                                                                                                                          |
| 4. `writeLocal` before `repairReferences`    | Fixed — `engine.ts:135-139`, and `repairReferences` is now non-mutating (`merge.ts:148-200`) with the regression documented in-place                                                                                                                                             |
| 5. "Loading…" flash on every write           | Fixed — `useEntries.ts:18,45`                                                                                                                                                                                                                                                    |
| 6. Phantom tables in `TABLES`                | Fixed — the list is now derived-from-schema-safe and `snapshotRepo.test.ts:134` reads `db.tables`                                                                                                                                                                                |
| 7–13, 16–25                                  | All fixed and verified, including `decodeURIComponent` (`router.ts:63-69`), `deleteProject` tombstones (`taxonomyRepo.ts:487-495`), the 320px row, `.env.example`, the README, the lexicographic e2e comparison (`smoke.mjs:29-35`), and the `DROPBOX_REDIRECT_PATH` duplication |

The only prior finding I would **reopen** is the one now filed as
[§5.6](#56-dead-and-speculative-code): `refreshToken`/`displayName` were correctly
removed from the stored token shape, but the cleanup left `isValidAppKey`,
`CloudIcon`, and a `status()` test double that still returns `account`.

Two genuinely new things have appeared since that review — the About page and its
changelog renderer, and the Phase 4 taxonomy UI — and both are where the new
findings cluster ([§8.1](#81-high--saving-an-empty-currency-selection-empties-every-currency-picker),
[§8.2](#82-high--a-running-entry-cannot-be-edited-without-retyping-its-duration)).

---

## 10. Spec ↔ code consistency

For the scope that is implemented, the specs and the code agree far more often than
not — including on the unglamorous parts. Spot-verified as consistent: 0003 E1–E5 /
P1–P6 (integer minor units, integer ms, UTC ISO, tombstones), 0004 T1–T6 / D1 / V1–V5 /
L1–L2 / ED3 / O2, 0005 P2 (revised, per-client uniqueness) / P3–P5 / P8 / A1–A2 / X1–X5 /
T1–T4 / U1–U2 / N2, 0007 S1–S6 / FB-4, 0008 J1–J12 / S1–S2 / F1–F3, 0009 (base path,
`404.html`, no source maps, CI gates, SHA-pinned actions), 0011 P1–P5 / N1–N4 /
R3–R7 / T1–T2, 0012 M1–M11 / C3–C8 / SY1–SY12 / AU1–AU10 / FL1–FL3, 0002 A1–A5 / R1–R4 /
CH1–CH6 / DEP1–DEP4 / O-1–O-3 / TC1–TC4.

### 10.1 Divergences

| #   | Requirement                                                                                        | Reality                                                                                                                                                                                                                                                                                 | Severity       |
| --- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| D1  | 0011 **N5** — CSP restricting `connect-src`                                                        | No CSP anywhere; the threat table already counts it as a mitigation ([§6.1](#61-high--there-is-no-content-security-policy-anywhere-_being-fixed-see-the-note-below_))                                                                                                                   | High           |
| D2  | 0012 **C1/C2/C7** — debounced sync on local write                                                  | `schedule()` unreachable ([§8.3](#83-high--sync-never-fires-on-a-local-write))                                                                                                                                                                                                          | High           |
| D3  | 0004 **M4** — no manual entry while a timer runs                                                   | Not implemented; Phase 2A claims M1–M4 ([§8.4](#84-medium--manual-entries-are-allowed-while-a-timer-runs))                                                                                                                                                                              | Medium         |
| D4  | 0007 **F-EXPORT-5/6/7** — Replace _and_ Merge modes; state added/replaced/skipped before and after | Merge-only; the backup reports one post-merge total. The decision is recorded in `0014` Phase 2B notes, but **0007 itself was never amended**, and 0014's own cross-cutting rule says the spec changes in the same commit as the code that revealed it                                  | Medium         |
| D5  | 0005 **P7** + 0003 currency resolution — one chain, ending at the app default then `USD`           | Three inline re-implementations with `'USD'` and `'GBP'` hard-coded; the app-default setting is ignored in two of them ([§5.3](#53-three-currency-fallbacks-where-the-spec-defines-one))                                                                                                | Medium         |
| D6  | 0010 **Q10** — Prettier enforced via a pre-commit hook                                             | No hook, no `husky`/`lint-staged`; CI's `format:check` is a different mechanism. Not recorded in `todo.md`                                                                                                                                                                              | Low            |
| D7  | 0010 **Q5** — coverage measured for `domain/` and high                                             | `test:coverage` exists; no thresholds, not in CI, no config in `vite.config.ts`                                                                                                                                                                                                         | Low            |
| D8  | 0010 **Q6/Q7** — `ProviderStatus` shape, `0002 §Application structure`                             | `status()` dropped the `account` field 0012 SY6 specifies (correctly — no scope for it — but the spec was not amended); the directory tree in 0002 lists `domain/models/`, `domain/aggregate/`, `import/`, `ui/` and none exist, and `domain/entries/`, `domain/taxonomy/` are unlisted | Low            |
| D9  | `SPECS/README.md` status table                                                                     | All 14 specs are still `Status: Draft` while the README reports phases 1–4 shipped and 725 tests pass. `SPECS/README.md:21` says "Every spec is `Draft` until you say otherwise" — so this is self-consistent, but the `Implemented` status exists precisely for this and is unused     | Low            |
| D10 | `0004 O3`, `0004 L3`, `0004 W2`                                                                    | Overlap marking, entry-list filtering by project/tag/billable/source/note, and stating elapsed time in the unload prompt are all unimplemented. `O3` is a SHOULD; `L3` is a MUST with no phase assigned to it in 0014                                                                   | Low (tracking) |

### 10.2 Citation drift

`0002` was restructured (routing is now `R1–R4`, architecture `A1–A5`) but the older
`B`-prefixed IDs were never updated, so several citations now point at nothing:

| Cited                | Where                                                        | Should be                                                                                          |
| -------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `0002 B1`            | `vite.config.ts:9`                                           | `0002 R1`/`0009 B*` — no `B` requirement exists in 0002                                            |
| `0002 B2`            | `scripts/check-silent-failures.mjs:155`, `SPECS/0014:64,437` | ditto                                                                                              |
| `0002 B7`            | `e2e/smoke.mjs:341`, `SPECS/todo.md:135`                     | ditto                                                                                              |
| `0007 M1`, `0007 M2` | `src/storage/db.ts:11,63`                                    | `0007 M-1`, `M-2` (hyphenated)                                                                     |
| `0007 FB3`           | `App.test.tsx:29`, `EntriesView.tsx:128`, 2 tests            | `0007 FB-3`                                                                                        |
| `0005 F4`            | `src/storage/taxonomyRepo.ts:62` (+2 tests)                  | **`0003 F4`** — "Deleting is for projects created by mistake"; 0005 has no `F` requirements at all |
| `0012 AR6`           | `docs/dropbox-app-setup.md:196`                              | `0011 AR6`                                                                                         |
| `0012 AU11`          | `src/sync/scheduler.test.ts:7`                               | no such requirement; 0012 has AU1–AU10 + dotted                                                    |

None of these indicate a wrong decision — the _decisions_ are all correct and the
prose around them is right. But a citation that resolves to nothing is the one
comment a reader cannot check, and this codebase's whole comment style depends on
the citation being checkable. A ~20-line script in `check-silent-failures.mjs` that
validates every `NNNN XX` reference against `SPECS/` would keep them honest going
forward — it is exactly the "adding a store without adding it here fails a test"
pattern `snapshotRepo.test.ts` already uses for tables.

### 10.3 Not-yet-built (expected, correctly tracked)

0006 reporting/billing, 0013 capacity entities, 0008 CSV writers, 0002 CH2–CH4 chart
primitives, 0007 FB-1/FB-2/FB-5 (quota, private browsing, `navigator.storage.persist`),
0007 F-NUDGE-1–4 (export nudges), 0007 E-ERASE-1–4 (**erase-all is absent — and
0007 calls it a MUST that must exist**), 0010 AC4–AC6 (chart equivalents, live
regions for the timer). All are assigned to Phases 5–8 in 0014 and none is
mistakenly claimed as done, with one exception worth watching: **"erase all data"
(E-ERASE) has no phase assignment I could find**, and it is the only missing feature
that is a privacy obligation rather than a feature.

### 10.4 The About page and changelog (`e5de0ed`)

Reviewed because it is the newest code in the repository. It is good work, and the
parts that matter most are the parts that are easy to get wrong:

- **The changelog is rendered as React nodes, never as HTML**
  (`AboutPage.tsx:141-164`), with the reason stated in the file header, and there is
  a test asserting no `<script>` reaches the DOM (`AboutPage.test.tsx:50-57`). For a
  feature whose input is "a Markdown file anyone can commit", that is the correct
  call and it is defended in the code rather than assumed.
- **The parser is deliberately partial** — headings, bullets, paragraphs, `**bold**`,
  `` `code` `` — and anything unrecognised falls through to a text node rather than
  being dropped. Links are rendered as their label because repository paths do not
  exist in a deployed bundle (`AboutPage.tsx:154-158`), with a test.
- **The route is wired correctly.** `#/about` is in `App.tsx`'s route table and
  linked from the foot of the settings page, and it does not add a fourth button to
  the header menu — the decision `todo.md` item 26 made deliberately.

Two observations:

1. **A heading-level jump.** `CHANGELOG.md`'s `##` entries render as `<h3>`, nested
   under the card's own `<h2>`. Correct. But the file's `###` sub-headings also
   render as `<h4>` (`AboutPage.tsx:114`) while the panel heading is `<h2>`, so the
   outline is `h2 → h3 → h4` only if the changelog uses `###`. Fine as written; worth
   knowing that the mapping is fixed rather than relative.
2. **Parser edge cases that are currently harmless.** A fenced code block would be
   rendered as a paragraph containing the fence characters; a numbered list
   (`1. item`) is not recognised as a list and becomes a paragraph. Both are
   invisible while the changelog uses only `##`/`###`, `-` and prose — which is
   exactly the kind of assumption that quietly rots when someone adds a numbered
   list. The header already says the parser handles "the subset the changelog
   actually uses"; it would be worth a test that asserts that subset, so adding a
   construct without extending the parser fails loudly rather than rendering oddly.

Bundle impact: [§8.7](#87-the-changelog-ships-inside-the-javascript-bundle).

---

## 11. What is genuinely excellent

Worth protecting through any refactor:

- **The pure domain layer is real.** `src/domain/` has no React, no Dexie, no
  `Date.now()`, no `window` — and `taxonomy/types.ts:59-64` declares its own
  `TaxonomyEntity` interface _specifically_ so it does not have to import from
  `merge.ts`. `convergence.test.ts` goes further than unit tests normally do and
  proves four-to-five-device convergence to a fixed point.
- **Total validation before any write**, with `looseObject` for forward
  compatibility so a newer build's fields survive an older build's import
  (`envelope.ts:49-56`) — the comment explains that plain `object` _strips_, which is
  the opposite of what you want here.
- **The mutation gate.** `scripts/check-silent-failures.mjs` is the thing I would
  most want to see in another repository. It restores files from bytes read
  beforehand, reports `stale` when the code moves, and lists the failures it cannot
  yet check with the phase that introduces them. It reports **11/11 caught** and I
  confirmed that independently.
- **Honest risk documentation.** `0011 §Accepted risks`, `0004 §Known limits of W4`,
  `SPECS/README.md §Known limitations`, and `todo.md §Notes worth keeping` all record
  what the design cannot do. `settingsRepo.ts:12-25` goes further and explains the
  _shape_ of the fix it is not making yet and why it needs its own decision.
- **Failure-mode-first engineering.** `ProjectUndoBar` restores only entries that
  are still live and still client-less; `undoDeleteProject` refuses on a name
  collision and says the entries stay uncategorised; `describeFailure()` refuses to
  guess at a cause it cannot evidence. That pattern — _report, never fabricate_ —
  is consistent across all three layers.
- **Accessibility treated as a requirement, not polish**: `visually-hidden` names on
  every icon-only control, `role="status"` on live regions, focus moved to the
  destructive-confirmation region, Escape handling in the header menu, and a
  permanently-reserved feedback line in `RateField` so a button cannot move under
  the pointer mid-click (with the _reason_ documented at length).
- **CI discipline**: SHA-pinned actions with version comments, `.nvmrc`-driven Node,
  `npm ci`, and a deliberately non-blocking browser job whose rationale is stated
  rather than left as an accident.

---

## 12. Recommended order of work

**Before the next push (silent failures first):**

1. Finish the CSP work already in progress: commit it, add the assertion that the
   served hash allow-list matches the inline bootstrap, and correct the 0011
   threat-model row ([§6.1](#61-high--there-is-no-content-security-policy-anywhere-_being-fixed-see-the-note-below_)).
2. Wire `scheduler.schedule()` to the revision counter ([§8.3](#83-high--sync-never-fires-on-a-local-write)).
3. Fix the empty-currency-selection path ([§8.1](#81-high--saving-an-empty-currency-selection-empties-every-currency-picker)).
4. Make a running entry editable ([§8.2](#82-high--a-running-entry-cannot-be-edited-without-retyping-its-duration)).
5. Fix the wrong comment in `names.ts` ([§5.1](#51-a-comment-that-contradicts-the-code)) and
   replace the three currency fallbacks with `resolveCurrency()`
   ([§5.3](#53-three-currency-fallbacks-where-the-spec-defines-one)).
6. Make the mutation gate distinguish a failed assertion from a broken module, so
   its "caught" verdict means what it says
   ([§8.6](#86-low--other-smaller-risks)). Today `AboutPage.tsx` compiles against
   `CHANGELOG.md?raw` whether or not that file is committed, so a future commit that
   forgets it only fails on CI or on a fresh clone — which is exactly the class of
   thing this project documents elsewhere and misses here.

**Then, in one batch:**

7. Tokenise the three sync-indicator colours and lift `#c98a12` over 3:1
   ([§5.7](#57-hard-coded-sync-indicator-colours-one-fails-contrast)).
8. 0004 M4's timer-running guard ([§8.4](#84-medium--manual-entries-are-allowed-while-a-timer-runs)).
9. Prune the duplicated JSDoc blocks; delete the dead exports
   ([§5.6](#56-dead-and-speculative-code), [§5.9](#59-smaller-smells)); de-duplicate the
   `.entry-edit` rules ([§5.5](#55-css-sprout-and-undefined-tokens)).
10. Repair the ten unresolvable spec citations and amend 0007 F-EXPORT-5, 0012 SY6
    and 0002's directory tree to match reality ([§10.2](#102-citation-drift),
    [§10.1](#101-divergences)).
11. Give the storage layer a provider-agnostic token store
    ([§5.4](#54-layering-inversion-storage-imports-from-syncdropbox)).

**Before Phase 5:**

12. One shared read context for entries and taxonomy ([§7](#7-performance)); a
    bundle-size check in CI so 0002 CH6 is enforced rather than remembered; a
    coverage threshold; the pre-commit hook 0010 Q10 asks for; and assign
    **0007 E-ERASE** to a phase — it is the one outstanding privacy obligation
    ([§10.3](#103-not-yet-built-expected-correctly-tracked)).
