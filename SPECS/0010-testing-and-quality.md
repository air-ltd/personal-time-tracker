# 0010 — Testing and quality

**Status:** `Draft`
**Depends on:** 0002

## Why testing matters more here than usual

Most of this app's code is arithmetic over time and money, where a wrong answer
is not obviously wrong. A one-hour DST bug produces a plausible-looking chart
that is simply incorrect. A merge tiebreak that is non-deterministic produces
data that diverges quietly across devices. Neither fails loudly, so the test
strategy is aimed at those specifically rather than at line coverage.

## Tooling

Vitest with React Testing Library, sharing the Vite config (0002). No separate
test runner.

- **Q1** — Tests MUST run without a browser where possible. `domain/` is pure
  precisely so the majority of tests run in a plain Node environment (0002 A1).
- **Q2** — IndexedDB MUST be faked in tests via `fake-indexeddb`, or tests MUST
  run in a browser environment. The choice MUST be made once and applied
  consistently, since mixing both invites storage-related false failures.
- **Q3** — Tests MUST NOT depend on the real system clock. Every function taking a
  timestamp takes it as a parameter (0002 A2), and tests pin the value.
- **Q4** — Fake timers MUST be used for anything touching the running timer or the
  debounce window, so tests are deterministic and fast.

## Priority 1 — must be tested

These are the bugs that will happen and will not be noticed.

**Time arithmetic**
- Duration across a spring-forward transition is 23 hours, not 24 (0006 DT3).
- Duration across an autumn-back transition is 25 hours, not 24.
- An entry spanning local midnight is split across two day buckets, not
  double-counted or dropped (0006 DT2).
- An entry clipped by a report range boundary contributes only its in-range portion.
- A zero-length entry is rejected; a sub-minute entry does not display as `0:00`
  (0006 RD1, F3).

**Rounding and money**
- Rounding is half-up, applied once, before multiplying by the rate (0006 RD4).
- Durations over 24 hours format correctly (0008 F2).
- The sum of line items equals the invoice total exactly (0006 I2).
- Minor-unit arithmetic produces no floating-point drift over thousands of
  additions (0003 P3).
- Percentage-of-total sums to 100.0 ± 0.1, or the residual is shown (0008 C10).
- A percentage change from a zero baseline renders as "new", not `Infinity`
  (0006 R5).

**Currency (0003 CU1–CU5)**
- Minor units from different currencies are never summed together; a mixed range
  produces per-currency subtotals (CU2).
- Currency resolution falls through project → client → app default correctly.
- `Intl.NumberFormat` output is used, not a hand-rolled symbol concatenation.
- `100` minor units renders as £1.00 in GBP and ¥100 in JPY — the case that makes
  naive minor-unit arithmetic obviously wrong.

**Merge (0012)** — the highest-value tests in the codebase
- Union of disjoint sets keeps everything.
- Same `id` on both sides resolves to the later `updatedAt`.
- An exact `updatedAt` tie resolves deterministically, and resolving twice yields
  identical output (0012 M4, M11).
- A deletion beats an older edit; a newer edit beats an older deletion (0012 M5).
- A merge does not resurrect tombstones (0012 M6).
- `schemaVersion` takes the maximum and is never downgraded (0012 M8).
- A newer remote `schemaVersion` refuses to sync and does not push (0012 M9).
- Referential repair runs after merge without dropping entries (0003 F1).

**Timer lifecycle**
- Starting twice does not create two entries (0004 T1).
- A running entry survives a simulated reload (0004 T5).
- Stop uses a single `now` for both display and persistence (0004 T3).
- Start while running is a no-op.
- The 24-hour and future-start validations reject with a message (0004 V2, V3).
- `beforeunload` prompts while running and does not register when idle (0004 W1, W5).
- Leaving via the prompt leaves the timer running — the elapsed time is not lost
  (0004 W3). This is the assertion that matters; the dialog itself cannot be
  meaningfully asserted in a test.

**Export and import**
- CSV output quotes fields containing commas, quotes and newlines (0008 C2).
- CSV includes a BOM and CRLF line endings (0008 C1, C3).
- `duration_minutes` is numeric and matches the sum of the human-readable column.
- Export → clear → import reproduces an identical database (0001 success
  criterion 3).
- Import validates before writing and applies nothing on failure (0007 F-EXPORT-4).
- Import merge and sync merge produce identical results from identical inputs.
- An export contains no tokens or credentials (0012 AU6).
- An unknown `format` or future `formatVersion` is rejected (0008 J11, J12).

**Sync engine**
- A failed push leaves local data untouched and usable (0012 SY3).
- A provider conflict rejection re-runs from pull rather than retrying the same
  push (0012 C5).
- Retries are bounded.
- Two triggers in quick succession do not run overlapping cycles (0012 C3).
- A clean local database does not push on open (0012 C7).
- Declining authorisation leaves the app fully usable (0012 AU8).

## Priority 2 — should be tested

- Each report's group, total and percentage figures against a hand-computed
  fixture.
- Validation rules: name uniqueness, colour format, rate non-negative.
- Project deletion orphans entries rather than removing them, and warns with a
  count (0005 X1).
- Archiving preserves historical entries and their colours (0005 A1).
- Tag merge folds one tag's entries into another (0005 T4).
- Referential repair on import: unknown project, unknown tag.

## Priority 1 — capacity (0013)

These are the newest and least battle-tested calculations in the app, and the
arithmetic is easy to get subtly wrong.

- A 40-hour Mon–Fri contract yields exactly 2,400 expected minutes for a normal
  week (0013 acceptance criterion 1).
- Marking one contracted day as non-working yields 1,920 for that week (N1).
- A 37.5-hour Mon–Thu 480 / Fri 300 pattern produces the correct figure, and does
  NOT equal 2,250/7 per day (K2, CP-A1).
- A Friday afternoon off removes half of Friday's contracted 300 minutes, not half
  of 480 (N8).
- A non-working day falling on a Saturday changes nothing (N2).
- Two overlapping non-working day records equal one (0003 NW5) — this is the
  idempotence guarantee, and it is what makes overlap validation unnecessary.
- Utilisation with no covering contract renders `—`, not `0%`, `NaN` or
  `Infinity` (CP-A6).
- A range spanning a contract change attributes each portion to its own contract
  (CP-A3).
- An annual holiday with weekend substitution lands on the correct observed date
  in two different years where the weekday differs (0003 NW7).
- One-off non-working days never shift (0003 NW10).
- Non-working days never contribute to worked or billable totals (N3).
- Weekday indexing is Monday-first in **every** code path — an off-by-one here is
  silent and shifts all expected minutes (K3).
- Contract validation rejects overlapping periods, a pattern that does not sum to
  `minutesPerWeek`, and a contract with no working days (0003 CT1, CT3, CT6).
- The even-split shortcut is refused when `minutesPerWeek` is not divisible by the
  working-day count — 2,250 over 4 days, not 2,250/4 rounded (0003 CT8).
- An odd contracted weekday in a half-day reduction does not silently lose a minute
  (CP-A4).
- A merge producing overlapping contract periods is surfaced (0012 M2.3).

## Priority 3 — integration and manual

- Each spec's acceptance criteria, executed against a real browser.
- The 0009 deployment checklist, against the live URL.
- A two-browser-profile sync scenario per 0012's acceptance criteria. Awkward to
  automate, and the highest-value manual test in the project.

## Coverage

- **Q5** — Coverage MUST be measured for `domain/` and MUST be high, since it is
  pure and cheap to test.
- **Q6** — No numeric coverage target is set. A percentage would encourage
  assertion-free tests that execute lines without checking behaviour.

## Quality gates

CI fails on any of (0009 CI1):

1. Type errors. `strict` mode with no escape hatches such as `any` in `domain/`
   or `!` non-null assertions on parsed external data.
2. Lint errors.
3. Failing tests.
4. Failed production build.

**Q7** — Parsed external data — imported backups, fetched sync blobs — MUST be
validated with a runtime schema and the result treated as unknown until then.
Types from a cast are a claim, not a guarantee.

## Accessibility

Treat as requirements, not polish. This app's whole interface is dense data.

- **AC1** — Every interactive element MUST be keyboard reachable and operable.
- **AC2** — Focus MUST be visible at all times.
- **AC3** — Colour MUST NOT be the sole indicator of meaning. Every chart colour
  pairing needs a second cue — label, pattern, or position (0005 N2).
- **AC4** — Charts MUST have a tabular equivalent (0006 C3), and the toggle to
  switch MUST itself be keyboard reachable.
- **AC5** — Charts MUST be reachable and explorable by keyboard, not hover-only
  (0006 C5).
- **AC6** — Live regions MUST announce sync state changes (0012 C8) and the
  timer's elapsed time at a low cadence, not every second, which would flood a
  screen reader.
- **AC7** — Colour contrast MUST meet WCAG 2.2 AA across both light and dark
  themes (0005 P4, 0002 TH6). Both theme palettes MUST be contrast-checked
  independently; a palette validated on one background tells you nothing about
  the other.
- **AC8** — Long-running work — merging, importing — MUST not freeze the UI.
- **AC9** — Theme switching MUST be possible from the UI, MUST apply without a
  reload, and MUST survive a reload (0002 TH1).
- **AC10** — The app MUST NOT flash the wrong theme on load (0002 TH4). This is
  testable by screenshotting the first paint with the theme set to the opposite
  of the OS preference — the exact case a `system`-following user would hit.

## Static analysis

- **Q8** — ESLint with `typescript-eslint` recommended and strict type-aware rules.
- **Q9** — A lint rule SHOULD flag `any`, non-null assertions and floating-point
  arithmetic in `domain/`, since those three account for most plausible bugs in
  this codebase.
- **Q10** — Formatting MUST be enforced by Prettier via a pre-commit hook, so
  diffs stay reviewable.
