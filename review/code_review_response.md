# Response to `review/code_review.md`

**Reviewed:** `e5de0ed` · **Responded:** `phase-4`, all findings dispositioned below.

The review's own summary was that this is "unusually disciplined code" whose findings are
"mostly gaps between an already-written specification and the code, not defects of
judgement". That was accurate, and it shaped the response: the work below is mostly closing
gaps, plus two new repository gates so the same gaps cannot reopen silently.

**One correction to the review's arithmetic, and one to a claim in it.** Details in §9 and
§5.7 below. Neither changes a recommendation.

## Verdict on the review

Accepted in full except where noted. Of the findings:

| Disposition                                   | Count |
| --------------------------------------------- | ----- |
| Fixed, with a test that fails without the fix | 17    |
| Fixed, with a test that guards it             | 12    |
| Accepted, deliberately deferred to Phase 5    | 2     |
| Disagreed, with the citation                  | 1     |

## 1. The four findings worth fixing before the next push

### §6.1 HIGH — no Content Security Policy · **fixed**

Accepted, and this is the most valuable change in the batch. `0011 N5` is unambiguous, and
the threat model counted the mitigation as banked while it did not exist.

Delivered as `<meta http-equiv>` injected by the build, not committed to `index.html`:
GitHub Pages cannot set headers, and the dev server rewrites `index.html` and injects its
own inline preamble, so a policy strict enough to be worth having would break
`npm run dev` and a policy loosened for the dev server would be no policy at all.

Three deliberate decisions, each with a reason recorded in `vite.config.ts`:

- **`script-src` is not relaxed.** The one inline script (the theme bootstrap, 0002 TH4) is
  allow-listed by a SHA-256 hash **computed from the emitted HTML at build time**, so the
  hash cannot drift from the script it describes. Verified in a real browser: corrupting the
  hash produces `Executing inline script violates the following Content Security Policy
directive`, which is how we know the policy is genuinely enforced rather than merely
  present.
- **`style-src 'unsafe-inline'`** is required by React's inline `style` attributes for the
  colour dots. The review gave this reason to the theme bootstrap, which is wrong — a script
  is governed by `script-src`, not `style-src`. The directive is still needed; the
  justification is not, so it is now correct.
- **`frame-ancestors` is absent, not present-and-ignored.** CSP silently ignores it via
  `<meta>`. Including it would read as clickjacking protection that does not exist, so
  `0011` records the limitation instead.

`e2e/smoke.mjs` gained seven checks: the policy is served, `connect-src` is exactly
`'self' https://api.dropboxapi.com https://content.dropboxapi.com`, `script-src` has no
`'unsafe-inline'`, `object-src` and `base-uri` are `none`, the inline bootstrap still runs
(a dark-theme preference survives the reload — the failure mode if the hash were wrong), and
no console error mentions CSP anywhere in the run.

`0011`'s threat-model row that claimed the mitigation was current now describes what is
actually in place.

### §8.3 HIGH — sync never fires on a local write · **fixed**

Accepted. This was the worst of the four: `schedule()` existed, was debounced, and was
fully tested — and nothing in the app called it. 0012 C1's "a local write" was the one
trigger of five that did not fire, silently, while its tests passed.

The fix inverts the trigger. `SyncScheduler` now subscribes to the storage layer's revision
counter inside `start()`, and detaches in `stop()`. That is not just tidier than wiring it
from `SyncProvider` — it removes the possibility of the bug. With the trigger supplied from
outside, `schedule()` was reachable only if every write path remembered to call it, none
did, and the debounce behaviour C2 describes was unreachable in production. There is now
nowhere else for the trigger to live.

Two details that needed care:

- **The scheduler's own write must not re-arm it.** Every merge writes locally, which bumps
  the revision, which would schedule a second cycle to publish what had just been written —
  two round trips per pull. A `writingLocally` flag around `writeLocal` distinguishes "the
  user changed something" from "I did". A revision _comparison_ cannot: a user write landing
  during a cycle is indistinguishable by number, and only by asking who caused it.
- **0012 C8's "pending changes" had no source at all.** `lastSyncAt` is about the past and
  `state` is about the current cycle; neither answers "is my work on the other device yet?".
  `SyncStatus.pending` is now emitted from the moment a change is registered, and the
  indicator has a third state — "Not synced yet" — rather than a green "Synced" beside a
  stale timestamp.

Four new scheduler tests, each of which fails if the trigger, the self-write guard, the
`stop()` detachment or the pending flag is removed.

### §8.1 HIGH — an empty currency selection empties every picker · **fixed**

Accepted. The panel tells the user twice that clearing the list returns the full ISO 4217
list, and the save path stored `[]`, which is not `null` — leaving every picker in the app
offering exactly one option: whatever that record already had. Reached by following the
instructions exactly.

Fixed at both ends, because they fail independently:

- **The save path** stores `null` for an empty selection, which is what the on-screen text
  promises.
- **`readVisibleCurrencies` normalises `[]` to `null`**, so a value written by an older build
  or a hand-edited database cannot become a trap.

The read-side fix initially made the mutation gate report a **GAP**, which was the gate
working correctly: with the read repairing `[]`, a test asserting "reads back as `null`"
passes whether the save wrote the right thing or the read papered over it. The test now
asserts the **stored record**, which is the actual contract. 18/18 caught.

### §8.2 HIGH — a running entry cannot be edited without retyping its duration · **fixed**

Accepted. 0004 ED1 requires every entry to be editable "including a running one"; ED2 says
editing `end` stops it. Both are true simultaneously only if saving _without_ stating an end
leaves it running. That was not the case: the duration and end fields both started empty,
submitting produced "Enter how long this took", and the only way to fix a typo in a running
entry's note was to also state a duration — which stops the timer as a side effect.

Saving without a stated end now leaves the entry running, and the form says so ("Still
running — 1h 30m so far. Enter a duration to stop it"), because otherwise a blank field is
indistinguishable from an oversight.

The design decision worth flagging: `validateEntry` gained an explicit `running` option
rather than accepting `end: null` outright. Only the caller that already holds the open-ended
entry may assert that, so a _new_ manual entry still cannot be created open-ended. Without
the flag, ED1 and 0004 M4 would contradict each other — which is precisely why M4 needed the
guard in §8.4 as well.

## 2. Bugs

### §8.4 MEDIUM — manual entries allowed while a timer runs · **fixed**

Accepted. 0004 M4 has three clauses and the review was right that none was implemented.
`/#/entries/new` now shows a prompt instead of the form.

Each clause is a separate thing that can go wrong, so each has a test: the form is not shown;
reaching the route **stops nothing** (an implementation that resolved M4 by calling `stop()`
as a navigation side effect would silently end an hour of work, and the test says so); and
stopping on request reveals the form.

### §8.5 MEDIUM — the merge's conflict retry ignores writes made during the cycle · **fixed**

Accepted. On a push conflict the engine re-pulled but merged the **in-flight** snapshot, so
an entry created while the network round-trip was in flight was in neither argument to the
merge — not merged, not pushed. No data loss, but "Sync now" reported success while omitting
the entry the user had just added.

It now re-reads local on that branch. One extra IndexedDB read on an already-rare path.

The test for this took three attempts to get right, and the wrong versions are worth
recording: the first set local _before_ `runSync`, which tests nothing; the second called a
replacement from a hook that was never wired to `push`. It only became a race once the
local write happened _inside_ the push. Verified in both directions — it fails against the
old code.

### §8.6 LOW — the smaller risks · **mostly fixed**

- **Edit route keyed on `editId` only** — fixed. Now keyed on the revision too, so a sync
  merge, a taxonomy delete or an undo in another tab cannot leave the form holding a stale
  record that a save would write back over the newer one.
- **`e2e/smoke.mjs` hard-coded `/personal-time-tracker/`** — fixed. The base is read out of
  the built `index.html`'s asset URLs. The review's point that the suite re-introduced the
  literal it exists to verify was exactly right: it would have failed confusingly the day
  the repository was renamed, and would have passed while proving nothing about a
  `VITE_BASE_PATH` override.
- **`check-silent-failures.mjs` counted any non-zero exit as "caught"** — fixed, and this
  turned out to matter. See §9.
- **`installTestDb` never closed the previous database** — fixed. 769 open connections in
  `fake-indexeddb` is a slow leak that eventually surfaces as unattributable flakiness.
- **`envelope.counts` validated but never cross-checked** — fixed. 0008 J5 exists so an
  importer can tell a complete file from a truncated one; validating the field was the easy
  half. Now a mismatch is refused with the per-table detail.

  One subtlety, found by a test: a count naming a table this build _stripped_ is **not** a
  mismatch. Refusing it would break 0008 J6, which requires an older build to carry a newer
  build's backup. Not being able to see a table is not evidence that its records are missing.
  One existing test's fixture was genuinely inconsistent (1 project, `counts.projects: 0`) and
  was corrected rather than worked around.

### §8.7 — the changelog ships in the bundle · **no change, agreed**

The review is right and explicitly not asking for a change: 7 KB of a 538 kB bundle, and the
decision is well argued. Recorded as directional rather than current.

## 3. Security

### §6.3 LOW — token discarded on a rejected write, silently · **fixed**

Accepted. `scope-missing` is usually a _Dropbox app console_ misconfiguration, not a bad
token: reauthorising cannot fix it, and the Connect button reappearing with no explanation
was the only clue. That message now names the app console and the redirect URI. The
`auth` case still reports the provider's own reason — the existing test's intent is
preserved, split into two tests.

### §6.4 LOW — build-time secrets footgun · **fixed**

Accepted. `.env.example` warned; nothing enforced it. New `npm run check:secrets`
(`scripts/check-no-bundled-secrets.mjs`) makes `VITE_*_SECRET`, `_PASSWORD`, `_TOKEN`,
`_PRIVATE_KEY` and `_CREDENTIAL` a build failure, in source and in `.env*` files — the
latter being invisible to review because they are gitignored, and still inlined into the
shipped JavaScript.

Matching on the _name_ rather than a blocklist is what makes it survive a rename. Verified in
both directions: clean tree passes, a planted `VITE_DROPBOX_APP_SECRET` in a `.env` and in
`src/` both fail.

Deliberately separate from `check:silent-failures.mjs`. That one asks "would the tests notice
this bug"; this one asks "is this file allowed to exist". Merging them would make each harder
to read and would mean the mutation gate's 18/18 claim quietly depended on the outcome of a
lint.

### §6.2 — what is right about the posture · **no change**

Agreed, and specifically: the token table being excluded from snapshots _structurally_
(`snapshotRepo.TABLES` simply does not name it) rather than filtered at write time is why
that defence is trustworthy. The `token-in-export` finding below shows that even this had
stopped being true of the test suite.

## 4. Spec ↔ code

### §10.2 citation drift · **fixed, and prevented**

All ten repaired. The substantive ones were not typos: `0005 F4` was cited from three files
for a requirement that has only ever existed in `0003`, and `0012 AU11` does not exist (0012
has AU1–AU10 plus AU3.1/3.2/4.1–4.4). Those were comments pointing at the wrong
requirement, which is worse than pointing at nothing.

The review suggested a script that validates every `NNNN XX` reference against `SPECS/`. Done
— `npm run check:citations`, in `verify` and in CI. It reads the ids each spec defines from
its own `**XX9** —` headings (in the two shapes the specs use, bold and not) and fails on
any citation that does not resolve. 436 ids across 14 specs; 123 source files; currently
clean.

It excludes `SPECS/` and `docs/` on purpose: a spec explaining an earlier version of itself
is not drift. It also excludes itself, since it names unresolvable ids on purpose to explain
what it is for — stated in the file rather than hidden.

### §10.1 divergences · **amended**

- **D1 (N5/CSP)** — fixed, §6.1.
- **D2 (C1/C2/C7)** — fixed, §8.3.
- **D3 (M4)** — fixed, §8.4.
- **D4 (0007 F-EXPORT-5/6/7)** — **0007 amended.** Merge-only is now recorded in 0007
  itself, with the reasoning: Replace is the more dangerous of the two and the only mode
  whose cost is irreversible, Merge is the only mode that can be safe by default, and since a
  backup is produced by the app that wrote it the realistic restore is always "bring back
  what I deleted". Anyone who wants Replace can export, clear site data, and import — a path
  that requires the user to name the consequence. The knock-on effect on F-EXPORT-6/7 is
  stated in the same place.
- **D5 (currency chain)** — fixed, §5.3.
- **D6 (0010 Q10 pre-commit hook)**, **D7 (Q5 coverage thresholds)** — **disagree, and
  recorded as limitations rather than built.** A pre-commit hook duplicates what CI already
  enforces; a coverage threshold nobody chose becomes a number that drifts and gets met
  rather than a signal. Both are now listed in `SPECS/README.md §Known limitations` with that
  reasoning, so the gap is visible rather than merely noted in a review.
- **D8 (ProviderStatus, 0002 tree)** — **0012 and 0002 amended.** `account` is dropped from
  `status()` in the spec's own code block, with the scope argument recorded: reading an
  account name needs `account_info.read`, and SY7's principle applies with more force to
  permissions than to type names. The 0002 directory tree now matches the code, with a note
  explaining each divergence — `domain/models/` → `domain/entries/` + `domain/taxonomy/`,
  `aggregate/` → grouped with the records it aggregates, `import/` folded into
  `export/envelope.ts` because import and export are one envelope read both ways, and `ui/`
  removed because no shared presentational component existed. A1–A5 are unchanged.
- **D9 (spec status)** — **restructured.** No spec file carries a `Status:` field at all,
  which is a stronger form of the review's finding than "the `Implemented` status is unused".
  Rather than add fourteen fields that would immediately start drifting, the status is a table
  in `SPECS/README.md` derived from what the phases shipped, with the reasoning stated: a
  per-file status field is only useful if something maintains it.
- **D10 (O3, L3, W2)** — **all three now have homes.**
  - **L3** (entry-list filtering) had no phase, and is a MUST. Assigned to **Phase 5**,
    because filtering the list and breaking down a report are the same query.
  - **O3** (overlap marking, a SHOULD) assigned alongside it.
  - **W2** — **the review has this as merely unimplemented; it is actually
    self-contradictory.** It requires the _prompt_ to state the timer and elapsed time, and
    W4 forbids a custom modal on the unload path because `beforeunload` cannot carry custom
    text. The original wording could only be satisfied by building something W4 prohibits.
    Amended to place the requirement where it can be met — the app's own UI states that a
    timer is running and shows elapsed time at all times while one is, which it does — with
    the residual limitation written down rather than glossed: a user who has scrolled past
    the panel sees an untexted dialog, and no static site can fix that.

### §10.3 — E-ERASE has no phase · **disagree**

**The one disagreement in this response.** `SPECS/0014-development-plan.md:408`, under
"Phase 8 — Release hardening":

> Erase-all, typed confirmation, no undo (0007 E-ERASE-1–4)

The assignment exists. It is Phase 8, alongside the CSP that has now shipped early. No code
change; noting the citation so the next reader does not repeat the search.

## 5. Code smells

### §5.7 hard-coded sync-indicator colours, one failing contrast · **fixed**

Accepted. `#c98a12` measured 2.85:1 on the light background — below WCAG 2.2 SC 1.4.11's 3:1
for meaningful non-text content, and below `MIN_CHART_CONTRAST`, the bar this project holds
every project colour to. Tokenised as `--sync-ok` / `--sync-warn` / `--sync-error`.

`--sync-warn` is now `#a86a00`: 4.30:1 on light, 4.14:1 on dark. Darkening it for the light
theme costs nothing on the dark one, so **one** value serves both palettes and there is no
theme-specific override to keep right.

Dot contrast is now measured rather than squinted at. `colour.styles.test.ts` asserts each
of the three against both `--bg` values _and_ against `--surface` — the dot is inside a
button, so checking only the page background would pass a colour that is hard to see in the
place it is used, and in each theme, which are different values. It also asserts the three
resolve through tokens, because the previous version passed every ratio check while being
three hex literals. Verified: restoring `#c98a12` fails two of them.

### §5.3 three currency fallbacks where the spec defines one · **fixed**

Accepted, and the concrete harm was real: the entry form ended at a hardcoded `USD`, both
project forms at a hardcoded `GBP`, and **the app-wide default currency the user chose in
Settings was ignored in all three**. The rate preview could say `£` about a rate that would
be billed in `JPY`.

All three now call `resolveCurrency`, and `resolveRateMinor` too. Four tests, verified to fail
against the old code.

`resolveCurrency`'s parameters are narrowed to `{ currency: string | null }`. That is not
convenience: three call sites have a currency but no record yet — a project form mid-edit, a
client picker before the row exists — and typing them as `Project` and `Client` would force
each to cast, or worse, to reimplement the chain. The narrowing is what keeps
`resolveCurrency` the only place the order is written down.

### §5.4 layering inversion: `storage/` imports from `sync/dropbox/` · **fixed**

Accepted. `secretsRepo`'s token table was typed by a Dropbox implementation module, so
adding a second provider — the whole point of 0012 SY6/SY9 — would have meant editing
`storage/`.

`TokenStore` is now `{ read(): Promise<unknown>; write(unknown); clear() }`, and the
defensive parse moved to `DropboxProvider.toTokens`, where only the provider knows what a
token for _it_ looks like. `storage/` imports nothing from `sync/`; verified by grep, not by
eye.

`read()` returns `unknown` rather than `unknown | null`, because `unknown` already includes
`null` and spelling both implies a distinction the type does not make. "No record" and "a
record holding null" are deliberately the same answer.

Two tests moved with the parsing. One changed shape rather than just relocating, and the new
version asserts something better: the old test proved `read()` returned a _stripped_ copy,
and the honest property is that **reading does not rewrite the stored record**. Writing back
a stripped copy on every read would permanently discard fields a later build might
reintroduce — the record would be destroyed by a version that simply did not know about them
yet. The provider now also _uses_ a record carrying unexpected fields instead of rejecting
it, since rejecting would strand the user: reauthorising produces the same shape.

### §5.2 render-phase side effect in `TaxonomySettings` · **fixed**

Accepted. A storage read was started during render behind a `setState`-to-guard-a-read flag,
which React's documented pattern does not permit and `StrictMode` double-invokes.

Fixed by deleting the code rather than converting it: three components each grew their own
copy of "read the app default currency", and they had drifted into three different
behaviours (§5.3). All three now use one `useAppDefaultCurrency` hook, which reads in an
effect with a cancellation flag, subscribes to the revision counter so changing the default
updates every open form, and returns `null` on failure — which is exactly what
`resolveCurrency` wants for "not configured yet". Six copies of the revision subscription
became one `useRevision`.

### §5.1 a comment that contradicts the code · **fixed**

Accepted. `names.ts` said "Deliberately **not** Unicode-normalised" and then argued for
normalising, on a function that normalises. This is the most damaging kind of comment
defect because a reader who trusts it will "fix" correct code. Rewritten to state what the
code does and why NFC is right, including why normalisation is applied last.

### §5.5 CSS sprout and undefined tokens · **fixed**

Accepted.

- **`.entry-edit` was declared four times in thirteen lines**, splitting `position`,
  `color` (twice, the later winning) and `background` across rules, plus twice more inside
  the media query. Merged to one rule plus one `:hover`. In the media block only what
  actually differs at that width was kept — the duplicated box properties and the identical
  hover wash were removed, because a duplicate is not obviously a duplicate and the narrow
  layout could silently drift from the wide one.
- **`--surface-2` was referenced five times and defined nowhere**, so every use fell back to
  an inline literal — the palette defined outside the block whose job is defining it. Now
  `--surface-2` and `--surface-2-strong` are declared per theme, because a dark translucent
  wash over near-black is invisible and the dark theme has to use a light one.
- **`--danger` was defined only under the dark theme**, with the light theme relying on an
  inline fallback. Both themes now declare it.
- A new test asserts **no custom property is used without being declared**, that no declared
  token carries an inline fallback, and that the two theme blocks declare the same set of
  names. That last one is what would have caught `--danger`.

### §5.6 dead and speculative code · **fixed**

Removed: `formatDayHeading` (dead, and a _worse_ duplicate of `EntryList`'s local `heading`,
which has a documented corrupt-key fallback), `draftFrom`, `matchRoute` and its tests,
`TaxonomyOption`, `TaxonomyEntity`, `PaletteColour`, and `snapshotRepo`'s redundant
`TimeEntry` re-export.

`CloudIcon` — the review is right that it was rendered nowhere and that `SPECS/todo.md`
item 17 claims otherwise. **Rather than delete the icon, it is now on the Connect Dropbox
button**, because that is what was asked for and the icon already existed. A new
`button-with-icon` rule uses `inline-flex` with a gap, since an inline SVG next to text in
an
`inline-block` box sits on the text baseline and collides with descenders. Decorative
(`aria-hidden`), so the button text is not read twice.

`isValidAppKey` — kept, and the doc comment now says why it is exported for tests only.
Rejecting a malformed `VITE_DROPBOX_APP_KEY` would silently discard a deliberate deploy-time
decision; what the check is _for_ is a typo in a built-in key, which otherwise surfaces as an
opaque "Invalid client_id" at the moment somebody tries to connect.

`listDeletedEntries` — kept, with a comment saying it is what 0007 E-ERASE needs and that it
must be assigned a phase before it gets a caller.

**The deliberate group** (`weekKey`, `dayKeysInRange`, `localDayLengthMs`, `countRecords`,
`sortEntriesForList`, `groupByCurrency`, `projectDefaultsToBillable`, `perceptualDistance`) —
kept, as the review recommends, and the recommendation acted on properly: a
`src/domain/README.md` now lists each one against the requirement it implements and explains
why it is not dead code. The reasoning is that a rule written in the domain and tested there,
then wired to a UI, has a correctness that does not depend on the UI being finished — the
alternative puts arithmetic somewhere it cannot be tested without a browser.

### §5.8 the dynamic import that does nothing · **no change**

Agreed, and left alone. `oauthCallback.ts` dynamically imports `./providerFactory` while
`SyncProvider.tsx` statically imports it, so Vite warns. But the _decision_ not to await the
callback is correct and the warning is about a bundling optimisation that cannot apply here:
the OAuth redirect handler runs before the app has rendered, so there is no chunk to defer
away from. Making the import static would silence the warning and remove the documentation of
why the callback is not awaited. Left with the build warning visible rather than papered over.

### §5.9 smaller smells · **fixed**

- `ColorPicker`'s `PALETTE.includes(normalised as never)` twice — replaced with a `Set`.
  The cast was working around the palette being a readonly tuple of literal types, and
  `as never` silenced it by disabling the check that was the point: the answer was being
  decided by an assertion rather than a comparison.
- `scripts/run.sh`'s stray `### End of File` marker — removed, and given a comment saying why
  the script exists rather than `npm run dev`.
- `SettingsPage`'s visually-hidden `<h2>Currencies</h2>` directly above
  `CurrencyPreferences`'s own `<h3>Currencies</h3>` — two identically-named headings in one
  card. Now `aria-label` on the section; no second heading in the accessibility tree.
- `ThemeToggle`'s static `theme-light` id — now `useId`-scoped. Harmless with one instance;
  a duplicate-id bug that makes the second toggle's label control the first one's radio the
  moment there are two.
- `engine.test.ts`'s `FakeProvider.status()` returning a field `ProviderStatus` no longer
  declares — removed, and the test double is now `unknown`-typed like the real store, so the
  defensive parsing it exists to exercise is actually reachable.

### §4 duplicated JSDoc · **fixed**

Three orphaned doc blocks removed (`merge.ts`, `entriesRepo.ts`, `taxonomyRepo.ts` — the last
had drifted far enough that `createTag`'s comment was sitting above a different function
entirely, and was reattached to the right one).

The repeated "awaited before navigating" rationale across `TimerPanel`'s prop doc, the call
site and `App.tsx` was left as-is: the review itself says three copies is one too many _and_
that they are the reason a real ordering bug was caught. Collapsing them to one risks losing
the explanation at the point where a reader needs it. A judgement call, recorded here so it
can be revisited.

## 6. Performance

### §7 — deferred to Phase 5, with the reasoning recorded

**The shared read context is not built now.** Two findings are real: `useEntries()` is
mounted twice on the home screen, and `useTaxonomy()` is mounted in five components, so each
write triggers several full table reads.

Deferred deliberately. `TaxonomyProvider` / `EntriesProvider` at the app root is the right
fix and the review is right that Phase 5's reports view will need both — but it is a
cross-cutting refactor of the read path, and doing it in the same batch as five behavioural
bug fixes makes neither reviewable. The dead subscription in `EntryList` (§7.1) is the cheap
half and is the part that is pure waste; the provider is Phase 5.

Bundle size is now **537.83 kB raw / 163.78 kB gzip**, against 0002 CH6's ~250 kB
trip-wire — 65%, with reports and charts still to come. No `size-limit` check added; it would
belong with the Phase 5 bundle work rather than as a threshold chosen today.

The 30-second clock tick re-running `groupEntriesByDay` is a decision, not an accident, and
stays one.

## 7. Prior review (`specs/review.md`)

Agreed with the review's assessment: all 25 findings genuinely fixed, re-verified rather than
taken from `todo.md`. One is reopened — `isValidAppKey`, `CloudIcon` and the `account` field
— and all three are now resolved above.

`SPECS/` and `specs/` differing only in case was a fair catch and is **not** fixed: the
lowercase directory holds the previous review, and moving it is a rename that touches git
history for no functional gain. Recorded rather than done.

## 8. New gates

Three, because each closes a class of defect no test asserts:

| Gate              | Catches                                                | In `verify`   | In CI          |
| ----------------- | ------------------------------------------------------ | ------------- | -------------- |
| `check:citations` | a requirement id that stopped resolving                | yes           | yes            |
| `check:secrets`   | a `VITE_*` credential that would ship to every visitor | yes           | yes            |
| `check:silent`    | a test suite that would not notice a reintroduced bug  | no, on demand | no, on purpose |

`check:silent` is deliberately absent from CI: it re-introduces bugs on purpose and re-runs
the suite once per mutation. The mutation count went from 11 to 18 — the four new ones cover
the local-write sync trigger, the app-default currency link, the empty currency selection and
the running-entry edit — and every one is verified to fail against the code it guards.

## 9. A correction to the review

The review reported `check-silent-failures.mjs` as **11/11 caught** and separately noted that
any non-zero vitest exit counted as "caught". Both statements are true and together they
meant something different from what a reader would assume.

The gate now requires a **failed test**, not just a non-zero exit. Applied to the existing
mutations, one immediately reported `ERR`:

> `token-in-export` — `src/export/envelope.test.ts` exited non-zero without reporting a
> failed test — the mutation broke the file rather than the behaviour

The replacement string in that mutation was missing a brace. It did not exercise the
behaviour it claimed to; it made `envelope.ts` unparseable, and the gate counted the parse
failure as coverage. So the review's claim that the `token-in-export` mutation "proves the
suite notices if that ever inverts" was **not** true, and neither was 11/11 as a statement
about the eleven behaviours.

Fixed in two steps, both verified:

1. The mutation was corrected to well-formed TypeScript. It then reported a genuine **GAP** —
   no test noticed the export schema gaining a `secrets` slot, because the existing AU6 test
   serialises a snapshot that contains no secrets and so can never contain one. It proved
   nothing.
2. A structural test was added: the envelope's declared tables must not include `secrets` or
   `meta`, checked against `db.tables` so the exclusions cannot pass by naming nothing. That
   fails on the mutation.

The existing AU6 test is _incidental_ — it can only pass. The new one is _structural_ — it
fails if the format gains a slot. Only together do they hold, and the comment in the test
says so.

**11/11 was 11/12 behaviours, and the twelfth was a syntax error.** It is 18/18 now, and the
claim is stronger than it was.

The same session found a second defect in the gate, in the other direction. Its header
claimed that restoring each file afterwards means "an interrupted run cannot leave a mutated
file behind" — and that was false for the interruption that matters. A run cut short by a step
timeout left two source files mutated, and the next `npm test` reported two defects that did
not exist.

The cause is not the `finally`, which is correct; it is that `runVitest` used `execFileSync`,
which blocks the event loop, and **Node does not run a signal handler while the loop is
blocked** — it swallows the signal and carries on. So no amount of `try`/`finally` could have
worked, and a JS-level handler alone would have looked right and done nothing. Verified
directly: a synchronous version runs to completion and exits 0 after `SIGTERM`.

Fixed by making the test run asynchronous and adding a handler that restores the in-flight
file on `SIGINT`/`SIGTERM`/`SIGHUP`. Verified by interrupting a real run mid-mutation: the log
reads `Restored src/sync/scheduler.ts after an interrupt` and the tree is clean. The mutations
run sequentially rather than under `Promise.all`, so two mutations of one file cannot race.

## 10. Still open

| Item                                            | Why                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Shared read context (§7)                        | Phase 5. The provider refactor is the right fix and belongs with the reports view that needs it. |
| `size-limit` in CI (§7)                         | Phase 5, with the bundle work CH6 governs. At 65% of the trip-wire.                              |
| `SPECS/` vs `specs/` case collision             | Not done: a rename for no functional gain. Noted.                                                |
| Replace-mode import (0007 F-EXPORT-5)           | Deliberately not implemented; the reasoning is now in 0007.                                      |
| 0010 Q5 coverage threshold, Q10 pre-commit hook | Declined and recorded as limitations rather than built.                                          |

## 11. Verification

| Check                     | Result                                                    |
| ------------------------- | --------------------------------------------------------- |
| `npm run typecheck`       | pass                                                      |
| `npm run format:check`    | pass                                                      |
| `npm run lint`            | pass                                                      |
| `npm run check:secrets`   | pass                                                      |
| `npm run check:citations` | pass — 436 ids, 123 files, 0 unresolved                   |
| `npm test`                | **771 tests / 43 files, all pass** (was 725)              |
| `npm run build`           | pass — 537.83 kB raw / **163.78 kB gzip**                 |
| `npm run test:e2e`        | **86/86** (was 79; +7 CSP checks)                         |
| `npm run check:silent`    | **18/18 caught** (was 11/11, one of which proved nothing) |
