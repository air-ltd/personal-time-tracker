# 0006 — Reporting and billing

**Status:** `Draft`
**Depends on:** 0003, 0004, 0005

## Principle

**RP1** — Every report MUST be computable at read time, with no persisted
results. Derived data cannot go stale.

Entry-only reports are computed from entries alone. Reports that compare against
an obligation — expected hours and utilisation — additionally require the capacity
entities introduced in 0013. See 0013 §The invariant this changes for the precise
split.

**RP2** — Totals MUST reconcile. The sum of a breakdown MUST equal the headline
total, with no unallocated remainder. Where a residual is unavoidable, it MUST
appear as an explicit bucket rather than vanishing.

**RP3** — Every report view MUST state its own date range, timezone and the basis
of its rounding. A number without its basis is not interpretable.

**RP4** — Any report depending on a contract MUST state which contract period
applied, and MUST NOT silently use a default when none covers the range
(0013 K5). A utilisation figure with an unstated denominator is the kind of number
that gets quoted out of context.

## Date ranges

**DR1** — The app MUST offer presets: today, yesterday, this week, last week, this
month, last month, last 30 days, last 90 days, all time.

**DR2** — "Week" and "month" MUST be calendar-based in the browser's local zone,
not rolling 7- and 30-day windows. People think in calendar weeks.

**DR3** — Week start MUST be user-configurable, default Monday. Hard-coding
Sunday-start would be wrong for most of the world, and guessing is worse than
asking.

**DR4** — Custom ranges MUST be selectable, inclusive of both endpoints by local
calendar date.

**DR5** — An entry MUST be included in a range if any part of it overlaps the
range, and the app MUST distinguish "entries overlapping" from "time inside the
range". The default MUST be time inside the range, clipped at the boundaries, so
a total never includes hours outside the period being reported on. The choice
MUST be exposed.

## Core reports

**R1 — Daily totals.** Per local day: total duration, per-project split, entry
count. Powers the entry list (0004 L1) and the trend chart.

**R2 — Breakdown by dimension.** For a range, group by project, client, or tag.
Each group shows duration, entry count, percentage, and monetary value where
billable. Groups MUST sort by duration descending by default, with a toggle for
name and chronological order.

**R3 — Client split.** Roll up by client, including the client-less bucket
(0005 R3). MUST show each client's share of both time and billable value.

**R4 — Trend over time.** Duration per day or per week across the range, so a
week is comparable to a week rather than a day to a month.

**R5 — Week over week.** Current period against the immediately preceding period
of equal length, showing absolute and percentage delta per group. Percentage
change from zero MUST render as "new" rather than divide-by-zero.

**R6 — Billable summary.** Totals for billable versus non-billable, plus total
monetary value.

**R7 — Unbilled work.** Billable entries with no resolved rate, surfaced as an
actionable list. This is the report that answers "what do I still need to price?"

## DST and time bucketing

**DT1** — All arithmetic MUST be on UTC instants, then bucketed into local
calendar days.

**DT2** — Because a local day is not a fixed number of milliseconds, day totals
MUST NOT be computed by dividing range duration by day count. Bucketing MUST
assign each entry to days by clipping it at local midnight boundaries.

**DT3** — A spring-forward day is 23 hours long and an autumn-back day is 25
hours long. Both MUST produce correct totals rather than a one-hour error. This
is the most likely place for a subtle bug in this app and needs a dedicated
test (0010).

**DT4** — Daily totals exceeding 24 hours are possible via overlapping entries
(0004 O2) and MUST render as-is, with the excess visible.

## Dates, locale and timezone

Resolved: store UTC, display in the browser's locale.

**DT5** — Instants MUST be rendered using the browser's locale and timezone via
`Intl.DateTimeFormat`. There MUST be no user-facing timezone setting. A
user travelling abroad sees times in the zone they are currently in, which is
what they expect from a personal tool, and a pinned zone would silently
misreport their day boundaries.

**DT6** — Day and week boundaries MUST follow the browser's local timezone, per
DT5. Two devices in different zones will therefore show different day totals for
the same entries. This is a consequence of DT5, not a defect, and it will not
affect a single user on a single timezone in practice.

**DT7** — ISO 8601 input and parsing MUST be explicit about the zone. A bare
`2026-10-03` in a form means local midnight; it MUST NOT be parsed as UTC.

**DT8** — Week start MUST come from the user's setting (DR3), not from the
locale, since no reliable automatic inference exists and Monday is the more
common expectation.

## Rounding

Rounding MUST be applied at the edges of a report, never to stored data.

**RD1** — Displayed durations SHOULD round to the nearest minute. Sub-minute
remainders MUST NOT be shown as `0h 0m` for a non-zero entry; seconds MUST be
available on hover or in the detail view.

**RD2** — Billable totals MUST be rounded to **15 minutes** by default. Fifteen
minutes is the conventional billing increment and is coarse enough that
hand-checking an invoice is practical.

**RD2.1** — The increment MUST be stored as a setting in `meta` so it can be made
configurable later **without a schema or migration change**. The UI control is
deliberately deferred rather than shipped now; the stored value exists from the
first release so that adding the control later is a UI change only.

**RD2.2** — Changing the increment MUST NOT retroactively alter stored entries.
Rounding is applied at read time (RD1), so a change affects all subsequent
reports. The app MUST NOT recompute or rewrite anything.

**RD3** — The rounding policy MUST be a single setting applied consistently to
every billable figure, so the same entry always produces the same number. Per
report overrides would make invoices disagree with on-screen totals.

**RD4** — Rounding MUST be half-up, and MUST be applied once to the final
rounded duration before multiplying by the rate.

**RD5** — The app MUST show both the raw duration and the rounded billable
duration wherever they differ. A user billing 1h 2m as 1h should be able to see
that this happened.

## Invoicing

Scope resolved: **totals and CSV line items only. No invoice document.**

**I1** — An invoice MUST be a derived view: a client, a date range, and the line
items produced by grouping billable entries by project. A printable or PDF invoice
is a non-goal for this version; it can be added later without changing the data
model, since it is purely a rendering of I1's line items.

**I2** — Line items MUST show description, quantity (rounded duration per RD2),
unit rate, and line total. Line totals MUST sum to the invoice total exactly.

**I3** — Where an entry's resolved rate differs from the project default, the
invoice MUST show the rate actually applied, not the default.

**I4** — Money MUST be formatted from minor units via `Intl.NumberFormat` with the
resolved currency (0003 CU5). Totals spanning multiple currencies MUST be split
into per-currency subtotals rather than summed (0003 CU2).

**I5** — The invoice MUST be reproducible: the same data and range MUST yield
identical output, so an exported invoice can be regenerated later and compared.

**I6** — Snapshots MUST NOT be stored. If the user edits rates afterwards, old
invoices change. This is acceptable for a personal tool; a stored snapshot is the
alternative if it becomes a problem.

## Charts

**C1** — Required views: daily/weekly bar chart over time; project breakdown as a
horizontal bar or donut; client split; week-over-week comparison.

**C2** — Charts MUST use the project and client colours from 0005, so a colour
means the same thing everywhere.

**C3** — Charts MUST have an accessible non-visual equivalent: a data table with
the same figures. A chart alone fails a user who cannot see it and fails
screen readers outright.

**C4** — Charts MUST NOT animate in a way that delays reading, and MUST NOT
depend on hover to reveal a value.

**C5** — Tooltips MUST be reachable by keyboard.

**C6** — Empty states MUST render an explanatory message, not an empty chart
frame. A zero-result report should say "no entries in this range", not show a
blank grid.

**C7** — Axis and figure formatting MUST match the rest of the app. No
`1.7999999999999998` from raw millisecond division.

## Performance

Confirmed volume: under ~100 entries per week for a single user. At roughly 5,000
entries after a year, this app's data is small.

**P1** — All aggregation MUST run synchronously in the main thread. At this volume
a full scan is imperceptible, and a worker or an incremental cache would add real
complexity for no measurable gain.

**P2** — Precomputed rollups are a non-goal. They MUST NOT be introduced: they
would create a second source of truth that can disagree with the entries, which is
precisely the failure 0006 RP1 exists to prevent.

**P3** — The entry list MUST NOT be virtualised. A year of entries renders
comfortably as ordinary DOM. Virtualisation adds scroll-position bugs for no
benefit and would complicate Ctrl-click multi-select for bulk edits.

**P4** — Pagination or a date-windowed query is nonetheless appropriate for the
entry list, since loading three years of history to show this week is wasteful.

**P5** — This section MUST be revisited if volume exceeds roughly 10,000 entries,
which is far beyond the confirmed case. The exit path is a web worker for
aggregation, not a rewrite.
