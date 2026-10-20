# 0003 — Data model

**Status:** `Draft`
**Depends on:** 0002

## Principles

- **P1** — Store timestamps as UTC ISO 8601 strings. Never local-time strings.
  A local-time string has no single correct interpretation once it crosses a
  timezone change.
- **P2** — Store durations as integer milliseconds. Never floats, never
  pre-formatted strings like `"1:30:00"`.
- **P3** — Store money as integer minor units (cents). Floating-point money
  accumulates rounding error across many additions and will produce totals that
  do not match the sum of the lines. Minor units are per-currency — see CU1.
- **P4** — Identifiers are UUIDs generated client-side. They MUST NOT be
  sequential or guessable; the data is importable and a user may merge backups.
- **P5** — Store instants, derive display. The rendering layer converts to local
  time. Nothing persisted is pre-formatted for display.
- **P6** — Store contracted durations as **integer minutes**. Never hours as a
  float. A 37.5-hour week is 2250 minutes; `37.5` cannot be represented exactly in
  binary floating point, so a float would drift across a year of weekly
  comparisons. This is the same reasoning as P3 applied to time, and the two must
  be applied consistently or totals will disagree with their own components.
- **P7** — Days are dates, not durations. A half-day is an explicit flag on a
  leave period, NOT half of 24 hours. See 0013 §Half days.

## Entities

### Project

| Field | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `name` | string | Required, trimmed, 1–80 chars, unique among the non-archived projects of the same `clientId` (0005 P2). `clientId: null` is one scope. |
| `clientId` | UUID \| null | FK → Client. `null` means non-client work. |
| `colour` | string | Hex `#rrggbb`, lowercase. |
| `defaultRateMinor` | integer \| null | Hourly rate in minor units. `null` = not billable by default. |
| `currency` | string \| null | ISO 4217. `null` = inherit the app default. See "Currency resolution". |
| `archived` | boolean | Default `false`. See 0005. |
| `createdAt` | ISO string | |
| `updatedAt` | ISO string | |

### Client

| Field | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `name` | string | Required, trimmed, 1–80 chars, unique |
| `colour` | string | Hex `#rrggbb`, lowercase |
| `defaultRateMinor` | integer \| null | Fallback rate. See "Rate resolution". |
| `currency` | string | ISO 4217 code. This client's billing currency. |
| `archived` | boolean | Default `false` |
| `createdAt` | ISO string | |
| `updatedAt` | ISO string | |

### Tag

| Field | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `name` | string | Required, trimmed, 1–40 chars, unique case-insensitively |
| `colour` | string | Hex `#rrggbb`, lowercase |
| `createdAt` | ISO string | |

Tags are flat. No nesting.

### TimeEntry

| Field | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `projectId` | UUID \| null | FK → Project. `null` = uncategorised. |
| `tagIds` | UUID[] | FK → Tag. Multiple. |
| `start` | ISO string | Required. UTC. |
| `end` | ISO string \| null | `null` **only** while running. See 0004. |
| `note` | string | Optional, 0–2000 chars. |
| `billable` | boolean | See "Rate resolution". |
| `rateOverrideMinor` | integer \| null | Per-entry rate. `null` = inherit. |
| `source` | `timer` \| `manual` | How the entry was created. |
| `createdAt` | ISO string | |
| `updatedAt` | ISO string | |
| `deletedAt` | ISO string \| null | Soft delete. See "Deletion". |

**E1** — Every entry MUST have a non-null `projectId` unless it was explicitly
saved as uncategorised. The app SHOULD require a project on save and offer
uncategorised only as a deliberate choice.

**E2** — `start` MUST be strictly earlier than `end` for any completed entry.

**E3** — `tagIds` MUST contain no duplicates.

**E4** — Exactly one entry in the database MUST have `end === null` at any time,
or zero. Never two. This is the running entry, and the timer UI depends on the
invariant holding globally, not just per view.

**E5** — `rateOverrideMinor`, when present, MUST be non-negative.

### Running entry
A running entry is a normal `TimeEntry` with `end === null`. There is no separate
table and no separate state machine persisted to storage.

**R-1** — Duration of a running entry MUST be computed as `now - start` at read
time. It MUST NOT be stored and accumulated, because a stored counter cannot
survive a page reload and will drift.

### Setting

A user's preferences, one row per setting, keyed by a stable name. Settings live
in their own table rather than in `meta`, because `meta` holds this device's own
sync bookkeeping (`lastRev`, `lastSyncAt`) and a preference must not travel with
it. Splitting the tables makes that exclusion structural rather than a rule
someone has to remember.

| Field | Type | Rules |
| --- | --- | --- |
| `id` | string | PK. The setting's stable name. |
| `value` | varies | The setting's value. Shape depends on the setting. |
| `updatedAt` | ISO string | |
| `deletedAt` | ISO string \| null | Soft delete, as entries |

A setting row is shaped exactly like every other mergeable record — `id`,
`updatedAt`, `deletedAt` — so settings merge through the existing union-by-id,
last-write-wins path with no merge rule of their own to be wrong.

| Setting | Type | Rules |
| --- | --- | --- |
| `app-default-currency` | string \| null | ISO 4217. `null` = fall back. 0003 CU1. |
| `visible-currencies` | string[] | ISO 4217 codes. 0005. |
| `entry-period` | `day` \| `week` \| `all` | How the entry list groups. 0004 L1–L2. |
| `week-start` | `monday` \| `sunday` | Default `monday`. 0006 DR3, DT8. |
| `billable-rounding-increment` | integer | Minutes. Default 15. 0006 RD2, RD2.1. |

The theme is deliberately **not** here: 0002 TH4 needs it readable before first
paint, and only `localStorage` can be read synchronously (0011 R5). The Dropbox
app key is also not here, because it is chosen by host and syncing it would let
a local build inherit the deployed app's identity.

**SET1** — A setting's `id` MUST NOT change once written. It is the merge
identity, so renaming one silently forks the value into two.

**SET2** — A setting MUST be absent rather than present-and-default where
absence and default mean different things. An absent `week-start` means the
default applies; a stored `monday` is the user having chosen it. The two must
not collapse, or a later change of default would rewrite an explicit choice.

## Derived values

**Duration**
```
completed:  end - start
running:    now - start
```

**Rate resolution** — evaluated in order, first hit wins:
1. `entry.rateOverrideMinor` if non-null
2. `project.defaultRateMinor` if the entry has a project and it is non-null
3. `client.defaultRateMinor` via the project's client, if non-null
4. no rate → the entry contributes to billable hours but has no monetary value

**Currency resolution** — evaluated in order, first hit wins:
1. `project.currency` if non-null
2. `client.currency` via the project's client
3. the app-wide default in `meta.currency` (0007 S3)
4. hard-coded fallback `USD`

**CU1** — `minor` is always interpreted in the *resolved currency's* minor unit.
Minor units are not interchangeable: 100 minor units is £1.00 in GBP and ¥100 in
JPY. Any arithmetic that mixes amounts MUST first group by resolved currency.

**CU2** — Reports MUST NOT sum across currencies. A total combining GBP and JPY
entries is meaningless. Where a range spans clients with different currencies, the
app MUST either present per-currency subtotals or refuse to total, and MUST say
which it is doing.

**CU3** — Currency conversion is a non-goal. No exchange rates are fetched or
stored. A user billing in multiple currencies sees separate figures, which is the
honest answer without a rate source.

**CU4** — The app-wide default currency MUST be settable by the user. It exists
because client-less work still needs a currency for display, not as an assertion
that the user bills in one currency.

**CU5** — Formatting MUST go through `Intl.NumberFormat` with the resolved
currency and the browser's locale. Hand-rolled currency formatting is where
symbol placement and separator errors come from.

**CU6** — An entry MUST NOT store its own currency. It is resolved at read time
from the project and client. Storing it would freeze a currency that later changes
at the client level, and 0005 P8 forbids retroactively relabelling money already
billed.

**CU7** — An entry with no project MUST resolve against the app default currency.

**Billable flag**
1. Explicit `entry.billable` if the user set it
2. Otherwise `true` when a rate resolved, `false` when none did

`billable` and the resolved rate are stored independently on purpose: an entry
can be billable at a rate the user has not decided yet, which is the common case
when capturing live and classifying afterwards.

**Monetary value**
```
valueMinor = round( (durationMs / 3_600_000) * rateMinor )
```
Rounding is half-up on the final product only. Intermediate durations MUST NOT be
rounded, or sums will not reconcile.

## Deletion

**D1** — Deleting an entry MUST set `deletedAt`. Rows are never physically
removed except by an explicit "erase all data" action (see 0007).

**D2** — Soft-deleted entries MUST NOT appear in any report, list, chart or
export.

**D3** — The application MUST offer an undo window after deletion. This is why
the soft delete exists: an accidental delete during review should cost one
keystroke, not an hour of history.

**D4** — A restore action MUST return a soft-deleted entry to the active set,
clearing `deletedAt`.

## Capacity entities

These model *expected hours*, not work done. They are deliberately separate from
`TimeEntry`: expected hours are a commitment, and a commitment is not something
you can record having met. Behaviour and the derived capacity figures live in
0013.

The separation matters concretely. If expected hours were an entry kind, every
"hours worked" query would need to exclude them, a contract would need
project/tag/rate fields it has no use for, and a stray tap could log eight
hours of Christmas as work.

**Expected hours are scoped to a client.** A contract period says how many hours
the user expects to spend on one client in a week, and what shape that week has.
The scope is the client, not the project: a project's hours are already a
subset of its client's, so a project-level contract would double-count against
its own client. Project-level budgeting is not built. The user's word for this
is "budget"; the spec says "contracted hours" throughout, and the two mean the
same thing.

### ContractPeriod

Contracted hours are effective-dated, because contracts genuinely change: an
annual increment, a mid-year reduction, a new client on a retainer. A single
global value would make historical reports silently wrong the day hours change.

| Field | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `clientId` | UUID | FK → Client. The scope. CT9. |
| `effectiveFrom` | ISO **date** | Local calendar date, inclusive. |
| `effectiveTo` | ISO date \| null | Inclusive. `null` = open-ended. |
| `minutesPerWeek` | integer | Weekly contracted total. P6. |
| `workPattern` | `DayPattern[]` | One entry per weekday, Monday-first. CT2. |
| `createdAt` | ISO string | |
| `updatedAt` | ISO string | |
| `deletedAt` | ISO string \| null | Soft delete, as entries |

`DayPattern`:

| Field | Type | Rules |
| --- | --- | --- |
| `weekday` | `0`–`6` | Monday-first. See 0013 K3 on why this is not `Date.getDay()`. |
| `minutes` | integer | `0` for a non-working day. Must sum to `minutesPerWeek`. CT3. |

**CT1** — Contract periods MUST NOT overlap *for the same client*. At most one
may be open-ended per client. Overlap is judged within a scope: two clients may
each have an open-ended period without either conflicting, because neither
speaks for the other's hours.

**CT2** — `workPattern` MUST cover all seven weekdays exactly once. A missing
weekday is ambiguous between "not specified" and "not working", and that ambiguity
would silently corrupt expected-hours calculations.

**CT3** — `workPattern.minutes` MUST sum exactly to `minutesPerWeek`. The app MUST
reject the contract rather than quietly preferring one number, since a mismatch
means the user does not know which is authoritative.

**CT4** — `minutes` MUST be non-negative and MUST NOT exceed 1440.

**CT5** — A non-zero `minutes` for a weekday means that weekday is a working day
for capacity purposes. `0` means not, which is how part-time and 4-day patterns
are expressed.

**CT6** — There MUST be at least one working day. A contract with no working days
has no denominator, and every utilisation figure against it would be undefined.

**CT7** — The form MUST offer an "even across working days" shortcut that derives
the whole `workPattern` from `minutesPerWeek` and a set of working days. The
stored form stays fully specified either way, so the shortcut is an input
convenience and never a second representation.

**CT8** — Where `minutesPerWeek` is not divisible by the number of working days —
2,250 minutes over four days, for instance — the even shortcut MUST NOT be applied
silently with a rounded figure. The app MUST either prompt for per-day overrides
or explain that the split is uneven. 2,250 / 4 is 562.5, and rounding it would
make the pattern stop summing to `minutesPerWeek`, violating CT3.

**CT9** — A contract period MUST name exactly one client. `clientId` is required:
a contract with no client has no scope, and expected hours cannot be compared
against anything. An archived client MUST NOT be offered when creating one
(0005 X4), because an archived client is not being worked for.

### NonWorkingDay

**Deferred — not built in this increment.** Leave and public holidays were
originally modelled here, as records that reduce a contracted day's expected
minutes to zero. The user has chosen to carry absence as an ordinary project
instead — a client-less project named for leave or non-work hours, with the
time recorded against it as usual.

That choice has consequences worth stating, because they are visible in the
numbers rather than hidden:

- The leave project's time counts as *worked* time in every total, because it is
  an ordinary entry against an ordinary project. It is not excluded anywhere.
- It counts against no client, because it has no client. So a client's
  expected-versus-actual comparison is unaffected by the user's own leave, which
  is the outcome the original design would also have produced for a client whose
  work was not delivered.
- A client whose office closes for a fortnight cannot have that fortnight removed
  from its expectation without this entity. The expectation simply goes unmet,
  and the utilisation figure says so.

The specification below is kept for the day the entity is built, and the
requirements it carries are marked deferred in 0013. Building it later is an
addition, not a correction.

Leave and public holidays have the same effect on capacity: the day is not
contracted, so its contracted hours become zero. They differ only in intent and in
how they recur, which is not enough to justify two entities and two code paths for
identical arithmetic. One entity, with `kind` retained for reporting and editing.

| Field | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `start` | ISO **date** | Local calendar date, inclusive |
| `end` | ISO date \| null | Inclusive. `null` = single day. |
| `kind` | enum | `leave` or `holiday`. For grouping and defaults only. |
| `label` | string | Free text, required, trimmed, 1–80 chars |
| `partDay` | enum \| null | `am` \| `pm`. `null` = whole day |
| `recurrence` | enum \| null | `null` or `annual`. Only meaningful for `holiday` |
| `observedShift` | enum \| null | `null`, `previous-friday`, `next-monday` |
| `note` | string | Optional, 0–500 chars |
| `createdAt` | ISO string | |
| `updatedAt` | ISO string | |
| `deletedAt` | ISO string \| null | Soft delete, as entries |

**NW1** — `label` MUST be free text, not a controlled enum. The set of reasons
someone is off work is open-ended and personal, and an enum forces the user to
file a real reason into "other" or invent a misleading category. Reports group by
label as-is. There is no privacy concern attached to it.

**NW2** — `start <= end`. `end === null` MUST be treated as `end === start`.

**NW3** — `partDay` MUST be `null` unless `start === end`. A half-day cannot apply
to a multi-day span; which half of a fortnight?

**NW4** — `recurrence` and `observedShift` MUST be `null` for `kind: leave`. A
personal day off does not recur annually, and silently repeating it would be a
genuinely damaging bug — it would erase a contracted day every year without asking.

**NW5** — **Overlaps MUST be permitted.** Unlike entitlement tracking, where two
overlapping leave records double-count an allowance, non-working days are
**idempotent**: two records both asserting "Tuesday is not contracted" produce the
same result as one. There is no quantity to double-count, so the validation that
entitlement tracking would need does not apply here, and blocking the user would
only stop them recording reality accurately.

**NW6** — Non-working days MUST NOT be billable and MUST NOT contribute to worked
or billable hours under any report. See 0013.

**NW7** — `recurrence: annual` MUST derive its occurrence from `start`'s month and
day for each year, then apply `observedShift`. This deliberately does NOT
implement iCalendar RRULE. It covers the real cases — Christmas, New Year, and
weekend-substituted bank holidays — without a rule engine nothing else would use.

**NW8** — The `nth weekday of month` case is **not supported**. Recorded as a known
gap rather than half-built, because a partial implementation that silently gets
Thanksgiving wrong is worse than one that makes the limitation visible.

**NW9** — Occurrences MUST be materialised for the years a report covers, and MUST
NOT be written as rows. Materialised rows would duplicate on every year change and
would be a second source of truth for a day the user can edit.

**NW10** — `observedShift` MUST NOT apply to one-off days. Substitution is an
annual-recurrence concern; a specific date the user entered is exactly the date
they meant.

**NW11** — The app MUST NOT ship a holiday database. Bundling a regional list means
shipping data that goes stale, guessing the user's region, and taking on a
maintenance burden for a one-line entry the user can add themselves. Import from
official sources is deferred (0013 §Deferred); manual entry is the supported path.

## Referential integrity

IndexedDB has no foreign keys. The following rules are enforced in application
code and MUST be validated on import (0008):

- **F1** — An entry referencing a missing `projectId` is treated as uncategorised,
  not as an error. Losing a project MUST NOT lose the entry or its duration.
- **F2** — An entry referencing a missing tag MUST have that tag dropped, keeping
  the rest.
- **F3** — Deleting a project MUST NOT delete its entries. Their `projectId` is
  set to `null` and the deletion is reported to the user. This is the single
  most destructive thing the app can do, and it must be explicit.
- **F4** — Archiving is the intended way to retire a project. Deleting is for
  projects created by mistake.
- **F5** — Capacity entities reference a client, and no foreign keys are
  involved. `ContractPeriod.clientId` points at a `Client`; `NonWorkingDay` is
  deferred and would reference nothing. Contract periods relate to each other
  only through their date ranges and their client, constrained by CT1 and CT9
  rather than by a FK.
- **F6** — F1 through F4 apply to every entity with a `deletedAt`, so all
  soft-deletion behaviour is uniform across the model.
- **F7** — A contract period whose `clientId` names a missing client MUST be
  dropped, and the drop reported. Unlike an entry, a contract cannot be
  "uncategorised": expected hours with no client have no scope to be compared
  against, so keeping it would produce a figure that matches nothing.

## Schema versioning

- **V1** — The store MUST carry a `schemaVersion` integer, stored in a dedicated
  metadata record.
- **V2** — Any change to entity shapes MUST increment it and register a migration
  in 0007's migration registry. Adding the contract period (0003) is one such
  increment: an existing database gains one store and no backfill, since absent
  contract periods correctly mean "no budget set for any client". The same
  increment carries the two settings added with it — `week-start` and the
  billable rounding increment — so that neither needs a migration of its own
  later.
- **V3** — Migrations MUST be applied on load, in order, and MUST be idempotent
  so a crash mid-migration can be retried safely.
- **V4** — The app MUST refuse to start against a `schemaVersion` greater than it
  understands, and MUST say so plainly rather than rendering an empty app and
  letting the user think their data is gone.
