# 0014 — Development plan

**Status:** `Draft`
**Type:** Plan, not a specification. Uses the same conventions, but the numbered
requirements live in 0001–0013.

## Shape of this plan

Sequenced to get something running and demonstrable as fast as possible, then
invest in the test suite, then add features.

That ordering is deliberately different from sequencing by risk. Normally the
riskiest pure logic — merge, DST arithmetic, rounding — would be built and
proven before any UI. Here it comes after a working thin slice. The trade is
accepted because:

- A thin slice exercises the data model against real use within days, so mistakes
  in 0003 surface while they are still cheap to change. A model perfected in
  isolation tends to be wrong in ways only usage reveals.
- Deploying early (Phase 1) removes the single most common way this kind of
  project silently fails: an app that builds fine and 404s in production.
- The risky logic is mostly pure functions, so it can be tested thoroughly in
  Phase 3 with no infrastructure to stand up first.

**Both external dependencies are front-loaded.** GitHub Pages (Phase 1) and Dropbox
OAuth (Phase 2B) are the two things that can pass locally and fail in practice.
Both are front-loaded for the same reason. Phase 1 is a hard prerequisite for
Phase 2B, because the OAuth redirect URI depends on the deployed Pages URL.

**Sync carries one exception.** It arrives early, but so does `domain/merge.ts`
and its tests, in the same phase. Sync is only as safe as the merge underneath it,
and shipping sync six phases ahead of merge's test discipline would be a real risk
rather than a hypothetical one.

**Sequencing is by dependency and by demonstration value, not by risk.** Risk
drives what gets tested hard in Phase 3, which is the §Silent failures section.

## No dates

Durations are not estimated here. There is no start date and no velocity to
estimate from, and inventing a calendar would create a plan that looks
authoritative while being fiction. Phases are ordered and gated; durations get
added once real throughput is known.

## Phases

Each phase ends at a gate. A gate not met means the phase is not done, regardless
of how much of it was built.

---

### Phase 1 — Skeleton and deploy

Get a static app live on GitHub Pages. Nothing else.

- Vite + React + TypeScript `strict`, Vitest, ESLint, Prettier, `npm ci` lockfile
- Hash router with a single placeholder route (0002 R1–R4)
- Empty app shell, themed
- GitHub Actions workflow: typecheck, lint, test, build, deploy to Pages (0009 CI1–CI5)
- Action versions pinned to full commit SHAs per repo policy
- `base` configured for the project-site subpath (0002 B1–B5)

**Why first, and why so small:** it exists purely to find out whether GitHub
Pages serves this correctly. The base-path failure (0002 B2) produces a blank page
with a fully passing local build and a fully green CI, and it is discovered far
more cheaply in the first hour than in the last.

**Gate**
- Live URL loads the app (0009 checklist 1)
- A deep hash URL loads directly, not a 404 (checklist 2)
- CI runs green on a push, and deploys to Pages
- Killing the network after first load leaves the app working

**Status:** built and verified locally. Not yet deployed — that needs `main`, so
the work has to reach it through a pull request first.

Verified against the build output rather than assumed: `base` resolves to
`/personal-time-tracker/`, `404.html` is emitted alongside `index.html` (0002 R4),
no source maps are produced (0009 C4), and `vite preview` serves the base path and
its assets with 200s. The pre-paint theme bootstrap is present in the served HTML.
22 tests cover routing normalisation, the not-found case, and theme resolution.

Outstanding for the gate itself, all of which need a merge to `main`:
- Push, open a PR, and merge
- Confirm the live URL and a deep hash URL on the deployed site
- Confirm Pages repository settings point at the Actions deployment
- Confirm the app works with the network disabled

---

### Phase 2A — Basic end-to-end

The minimum thing a person could actually use. Timer, entry, storage, list.
No reports, no taxonomy beyond a hardcoded default.

- `storage/`: Dexie schema, `entries` and `meta` stores, repository layer
  (0007 S1–S6)
- Timer state machine: start, stop, resume on load, discard (0004 T1–T6)
- Wall-clock duration from timestamps, never an accumulated counter (0004 D1)
- Manual entry: start, end, duration-first input, note (0004 M1–M4)
- Entry validation: end after start, 24-hour cap, no future start (0004 V1–V5)
- Entry list grouped by local day with per-day subtotals (0004 L1–L2)
- Soft delete with undo (0003 D1–D4)
- Edit any entry, including a running one (0004 ED1–ED4)
- `beforeunload` warning, defaulting to continue (0004 W1–W7)
- `pagehide` handler registered

**Deliberately excluded:** projects, clients, tags, reports, charts, capacity,
export. An entry can be uncategorised, which 0003 E1 permits.

**Gate**
- A user records an entry, stops it, sees it in the list, edits it, and it is
  still there after a reload
- A running timer survives reload and reports the correct elapsed span
- Closing the tab prompts, and the timer is still running afterwards
- Deleting an entry is undoable

---

### Phase 2B — Sync

Brought forward from the end of the plan. The reasoning is the same as Phase 1:
Dropbox OAuth involves external setup — app registration, an exact redirect URI,
a consent round-trip — and every part of it can pass locally while failing in
practice. Discovering that in Phase 2B costs an afternoon; discovering it in what
was Phase 8 would cost a day and a redesign.

**This phase also builds `domain/merge.ts`, and its tests come with it.** Merge is
the highest-risk component in the project, and shipping it into the world six
phases before its test discipline would be a real risk, not a hypothetical one.
The Phase 3 suite then *deepens* merge testing rather than introducing it.

- `domain/merge.ts`: union by `id`, last-write-wins, deterministic tiebreak,
  tombstones preserved, `schemaVersion` takes the maximum (0012 M1–M11)
- Merge tests alongside it: union, tie determinism, idempotence, no
  resurrection of deleted entries, refusing to downgrade the schema version
- JSON backup envelope, since the sync blob *is* the backup format (0012 SY4,
  0008 J1–J12). Export and import of the same envelope come too, so the round-trip
  is exercisable
- `SyncProvider` interface, then the Dropbox implementation (0012 SY6–SY9)
- OAuth PKCE. Tokens in IndexedDB. Sign-out preserves local data (0012 AU1–AU8)
- Engine: pull, merge, push with `expectedRev`, bounded retries and backoff
  (0012 C4–C5)
- Scheduler: app open, debounced writes, tab focus, `pagehide`, manual button, no
  polling (0012 C1–C7)
- Sync status UI: last synced, pending changes, errors (0012 C8)

**Note the dependency on Phase 1.** The OAuth redirect URI must exactly match the
deployed GitHub Pages URL. Until Phase 1 has shipped, the URL the app is served
from does not exist, so the OAuth configuration cannot be correct. Phase 1 is
therefore a hard prerequisite, not just a risk check.

**Verify provider API details against current vendor documentation rather than
from the spec** (0012 SY10): OAuth PKCE support, exact scope strings, app-folder
path semantics, the revision field, token refresh. The embedded client id is public
under PKCE and is not a secret (0012 AU3, AR6).

**Gate**
- The 0012 acceptance criteria pass, including the two-browser-profile test
- Declining authorisation leaves a fully working local-only app
- Killing the network mid-sync corrupts nothing; local data stays usable
- An exported backup contains no OAuth tokens (0012 AU6)
- Export → wipe → import → identical state

---

### Phase 3 — Test suite

Not "write more tests later" — this is where the suite stops being incidental and
becomes the main asset, and where the risky arithmetic gets pinned down.

Merge already exists and is tested from Phase 2B. This phase deepens it:
property tests over randomly generated record sets, convergence across three or
more simulated devices, and the contract-period overlap case (0012 M2.3) once
capacity entities exist.

**Infrastructure decisions, made once**

- Storage environment: `fake-indexeddb` or a real browser environment. One choice,
  applied consistently. Mixing both invites false failures (0010 Q2)
- Fake timers for everything touching the timer or the debounce window (0010 Q4)
- Shared fixtures: a factory for entries, contracts, non-working days, with
  deterministic UUIDs and timestamps. Tests that hand-write four entities inline
  drift apart within a week
- One helper for asserting duration totals, so "expected 2,400 minutes" is written
  once

**Property and edge-case tests for the silent failures** (see below)

- Time arithmetic: spring-forward, autumn-back, entries crossing local midnight,
  range clipping (0006 DT1–DT3)
- Rounding and money: half-up applied once before multiplying by rate; no float
  drift; line items summing to the invoice total; `0%` vs `—` from a zero
  denominator (0006 RD1–RD5, 0003 CU1–CU5)
- Merge: union, last-write-wins, deterministic tiebreak, idempotence,
  tombstones never resurrecting, `schemaVersion` never downgrading (0012 M1–M11)
- Timer: no double entry, single `now` on stop, survival across reload (0004 T1–T6)
- Round trip: export → wipe → import → byte-identical database (0001 criterion 3)
- Reconciliation: every breakdown sums exactly to its headline total (0006 RP2)

**Import validation tests** (0007 FB4, 0008 J11–J12): malformed backups, future
schema versions, duplicate ids, `end` before `start`.

**Coverage**

- Measured and high on `domain/`, which is pure and cheap to test (0010 Q5)
- No numeric target. A percentage encourages assertion-free tests that execute
  lines without checking behaviour (0010 Q6)

**Gate**
- The suite catches each silent failure below when that failure is deliberately
  introduced and then reverted
- Round-trip identity holds
- `domain/` coverage is reported and reviewed

---

### Phase 4 — Taxonomy

- Project, client, tag CRUD (0005 P1)
- Palette-based colours, contrast-checked in both themes (0005 P3–P4, 0002 TH6)
- Inline tag creation, case-insensitive dedupe (0005 T1–T2)
- Tag merge (0005 T4)
- Archive and restore for projects and clients (0005 A1–A5)
- Delete project orphans entries, with a warned count (0005 X1–X3, 0003 F3)
- Currency per client and per project, resolution chain (0003 CU1–CU7, 0005 P6–P8)

**Gate**
- Deleting a project leaves its entries intact and unprojected, with a count shown
- Archiving preserves historical entries and their colours

---

### Phase 5 — Reports and charts

- Range presets, calendar week/month, custom range (0006 DR1–DR5)
- Entry-only reports: daily totals, breakdown by project/client/tag, trends,
  week-over-week, billable summary, unbilled work (0006 R1–R7)
- Hand-rolled SVG chart primitives, shared palette (0002 CH1–CH4)
- Tabular equivalent for every chart, keyboard reachable (0006 C3, 0010 AC4–AC5)
- Billable rounding at 15 minutes, with raw and rounded both shown
  (0006 RD1–RD5, RD2.1)
- Theme: light, dark, system, with the pre-paint bootstrap mirror
  (0002 TH1–TH6, 0011 R5)

**Gate**
- Every breakdown sums exactly to its total, with no unallocated remainder
- Every chart has a working keyboard-reachable table equivalent
- Rounding is applied once, and the invoice total matches the sum of its lines

---

### Phase 6 — Capacity

- `ContractPeriod` CRUD, effective-dated, non-overlapping (0003 CT1, 0013 K1–K4)
- Even-split form shortcut, refused when not divisible (0003 CT7–CT8)
- `NonWorkingDay` CRUD: leave and holiday kinds, free-text label, ranges, half
  days (0003 NW1–NW3)
- Annual recurrence and weekend substitution, no RRULE (0003 NW7–NW10)
- Overlaps permitted and idempotent (0003 NW5, 0013 N1–N2)
- Expected minutes: mandatory per-day loop (0013 CP-A1–CP-A4)
- Utilisation, expected vs actual, non-working days taken, calendar,
  absent-vs-unlogged (0013 CR1–CR6)

**Gate**
- A 40-hour Mon–Fri contract yields exactly 2,400 expected minutes for a week
- Marking one contracted day yields 1,920 for that week
- Utilisation renders `—` when no contract covers the range
- Weekday indexing is Monday-first in every code path

---

### Phase 7 — Export

The JSON envelope and its round-trip ship in Phase 2B, since it doubles as the
sync wire format. This phase completes export as a *reporting* tool.

- CSV writers: entries, summary, non-working days, contracted hours
  (0008 C1–C16)
- BOM, CRLF, RFC 4180 quoting — verified by parsing the output with a real parser,
  not by eyeballing it
- Per-currency `TOTAL` rows rather than a meaningless combined figure (0008 C11)
- Non-working day `days` column computed against the work pattern, de-duplicated
  (0008 C12, C14)
- Import summary: what was added, replaced, skipped, and why (0007 F-EXPORT-6–7)

**Gate**
- A CSV containing commas, quotes and newlines in project names parses cleanly
- The summary export's percentages sum to 100.0 ± 0.1, or the residual is shown
- Export → wipe → import → identical state, verified on a fresh profile

---

### Phase 8 — Release hardening

Sync has been live since Phase 2B, so this phase treats a real multi-device
history as the thing to verify against, not an empty database.

- Accessibility pass against 0010 AC1–AC10, including the theme-flash check
- Backup nudges and data-loss warning states (0007 F-NUDGE-1–4, FB3, FB7)
- First-run versus empty-after-data states must look different (0007 FB3)
- Storage quota and private-browsing handling (0007 FB1–FB2, FB5)
- Erase-all, typed confirmation, no undo (0007 E-ERASE-1–4)
- CSP finalised: `connect-src` limited to the provider (0011 N1–N6)
- Full 0009 deployment checklist against the live URL
- Cross-version compatibility verified: an older build can still read a database a
  newer build wrote, or fails loudly (0003 V4, 0009 V3). **This matters more than
  it did before**, because a schema change in Phase 4 onward now reaches devices
  that have been syncing since Phase 2B
- Long-run sync soak: leave it running across a real week and confirm no drift,
  duplicate or lost write

**Gate**
- Full 0009 checklist passes on the live URL
- No request leaves for an unexpected origin
- The app is usable end to end with the network disabled

## Silent failures

The specific things that will break and will not announce themselves. These drive
the Phase 3 test priorities, and each is worth re-checking whenever the code
around it changes.

| Failure | Why it is silent | Spec |
| --- | --- | --- |
| Spring-forward or autumn-back day off by an hour | Totals look plausible | 0006 DT3 |
| Merge tiebreak non-deterministic | Devices never converge; no error surfaces | 0012 M4 |
| Tombstone resurrected by an older device | Deleted entries reappear weeks later | 0012 M6 |
| Rounding applied before multiplying by rate | Line items do not sum to the invoice total | 0006 RD4 |
| Float drift in money | Totals disagree with their own components by a cent | 0003 P3 |
| Utilisation divide-by-zero | `NaN`, `Infinity` or a misleading `0%` | 0013 CP-A6 |
| Weekday off-by-one | Every expected-minute figure shifts by a day | 0013 K3 |
| Breakdown does not reconcile to total | Silent; looks like normal rounding | 0006 RP2 |
| Base path wrong | Blank page in production, green local build and green CI | 0002 B2 |
| New entity type added, forgotten in merge | That data never syncs, with no warning | 0012 M2 |
| CSV quoting missed | Spreadsheet silently mis-parses a row | 0008 C2 |
| Theme flash | Cosmetic, but tells the user the app is unpolished | 0002 TH4 |
| OAuth token ends up in an export | A backup file that grants access to the provider | 0012 AU6 |
| Overlapping sync cycles | Duplicate or lost writes under rapid editing | 0012 C3 |
| A schema change strands a syncing device | Refuses to sync, looks like data loss | 0003 V4, 0012 M9 |

**The first seven of these are live from Phase 2B onward**, because sync is. The
merge rows are marked accordingly: they are the reason `domain/merge.ts` ships in
Phase 2B with its tests rather than waiting for Phase 3.

## Cross-cutting

Not phases. These apply continuously and will not be done if left to a phase.

- **Accessibility** is part of each phase's gate, not a final pass. Retrofitting
  keyboard support across a reporting UI is far more expensive than building it in
  (0010 AC1–AC10)
- **Spec amendments** are expected. When implementation reveals 0001–0013 is wrong,
  the spec changes in the same commit as the code that revealed it
- **`domain/` stays pure** — no React, no IndexedDB, no `Date.now()`. If this rule
  erodes, the test suite degrades with it (0002 A1–A2)
- **No phase may defer a data-loss bug.** Fix it before moving on

## Deliberately not in this plan

Deferred features, from the README § Deferred table. Each is a contained addition
at the point it is picked up, and none blocks anything above:

- Rounding increment UI control
- Printable invoices
- `.ics` import
- Holiday import from official sources
- Leave allowance and entitlement
- `nth weekday of month` holidays
- A second sync provider
- Client-side encryption of the sync blob

## First actions

1. Confirm the stack table in 0002 is what you want to build against
2. Confirm this phase order, or say what to reorder
3. **Create the Dropbox app and note the client id and app folder path.** This is
   the longest-lead item and it involves someone else's setup UI. Doing it before
   Phase 1 is finished means Phase 2B has no external dependency left to wait on
4. Decide the storage-testing environment: `fake-indexeddb` or a real browser
   environment. Decide before Phase 2A, because it shapes how the repository
   layer is written
5. Scaffold Phase 1. Confirm the deployed URL, then wire it as the OAuth redirect
   URI
6. Create issues for Phases 1, 2A and 2B, and defer 3–9 until the plan has proved
   out against reality

## A caution about syncing real data early

Sync is live from Phase 2B, which means real data can reach a real provider before
the test suite is at full strength. Two mitigations, both cheap:

- **Use a separate, disposable set of entries** until the Phase 3 gate passes. Sync
  correctness is only interesting on data you are willing to have merged wrongly
  once.
- **Local storage remains the source of truth** (0012 SY1), so a bad merge is
  recoverable by re-importing a good backup. That is a real safety net, but it
  requires the user to have exported before the bad merge happened — which is
  another reason Phase 2B ships export alongside sync.
