# 0013 — Non-working days and contracted hours

**Status:** `Draft`
**Depends on:** 0003, 0004, 0006
**Amends**: 0001 (glossary), 0006 RP1

## What this is for

One question: **of the hours I am contracted to deliver, how many am I actually
delivering?**

The app previously had a numerator with no denominator. Marking a day as leave or
a public holiday is the mechanism for reducing the denominator — contracted hours
for that day drop to zero — which makes the utilisation figures meaningful.

That is the whole feature. There is deliberately no leave entitlement tracking.

## The invariant this changes

0006 RP1 states that every report is computable **from entries alone**. That is no
longer true for capacity figures, and pretending otherwise would be the easy
mistake here. Entry-only reports are unaffected.

| Report | Inputs |
| --- | --- |
| Duration by project / client / tag (0006 R2, R3) | entries only |
| Billable summary (0006 R6) | entries only |
| Trends (0006 R4, R5) | entries only |
| Expected hours | contract + non-working days |
| Utilisation | expected hours + entries |

**CP1** — All of these MUST still be computed at read time. Nothing is
precomputed, consistent with 0006 P2.

**CP2** — Absence MUST NOT be modelled as a `TimeEntry` of kind "leave". See 0003
§Capacity entities for the reasoning. The separation is load-bearing.

## Non-working days

Leave and public holidays are one entity, `NonWorkingDay` (0003), with `kind` for
reporting. They have identical arithmetic — both make the day uncontracted — and
two entities would mean two code paths for the same calculation.

**N1** — A `NonWorkingDay` MUST reduce that day's contracted minutes to zero. This
is the core behaviour: mark a day, and it stops counting towards the obligation.

**N2** — A day that is already non-working in the contract pattern — a Saturday in
a Monday-to-Friday week — MUST be unaffected. Recording it as a non-working day is
a no-op, and the app MUST NOT treat it as an error.

**N3** — A non-working day MUST NOT be billable and MUST NOT contribute to worked
or billable hours (0003 NW6). Absence is not work of a different kind.

**N4** — Working on a non-working day MUST be permitted. People do work on public
holidays, sometimes at a premium. The app SHOULD warn when starting a timer on such
a day, and MUST NOT block it.

**N5** — `label` is free text (0003 NW1). The app MUST NOT offer a fixed list of
reasons, MUST NOT require one, and MUST NOT infer one. Grouping in reports uses
whatever text the user chose.

**N6** — Recurrence applies only to `kind: holiday` (0003 NW4). Leave never
repeats.

### Half days

**N7** — A half day MUST be an explicit `am` or `pm` flag (0003 P7), never half of
24 hours or half of a standard day.

**N8** — A half day MUST reduce that weekday's contracted minutes by half of *that
weekday's* figure, not half of an average day. If Friday is contracted at 300
minutes, a Friday afternoon off removes 150.

**N9** — Half days are optional and secondary to the main behaviour. If they prove
more trouble than they are worth in practice, dropping them costs only the
`partDay` field and N8 — the rest of the model is unaffected.

## Contracted hours

**K1** — Contracted hours are stored per `ContractPeriod` (0003), effective-dated.
Confirmed necessary: hours change, and a single global value would make historical
reports wrong from the day they did.

**K2** — The week MUST be expressible per weekday, because contracted hours are
rarely uniform. A 37.5-hour contract is commonly Mon–Thu 8h and Fri 5h, and
dividing by five gives the wrong expectation for every individual day. The common
case of even hours is a form shortcut (0003 CT7), not a separate model.

**K3** — Weekday indexing MUST be Monday-first, consistently everywhere: UI,
storage, reports, CSV and tests. JavaScript's `Date.getDay()` is Sunday-first and
is a reliable source of off-by-one bugs. This MUST be handled in exactly one place
in `domain/` and never inline.

**K4** — Contract periods MUST NOT overlap, and at most one may be open-ended
(0003 CT1). The app MUST refuse to create a second open-ended period rather than
leaving the user to work out which applies.

**K5** — If no contract period covers part or all of a report range, expected hours
for that portion MUST be reported as **unknown**, not as zero. Zero contracted
hours makes utilisation divide by zero, and "unknown" is the truth.

**K6** — A contract with no working days MUST be rejected (0003 CT6), because it
has no denominator.

### Changing a contract

**K7** — Editing a contract that already has reports run against it MUST NOT
rewrite history. Since reports compute at read time (CP1), the honest behaviour is
that figures recompute against the current contract — which means a contract edit
silently changes last quarter's utilisation. The app MUST warn before saving such an
edit.

**K8** — The intended flow for a change is: close the current period with an
`effectiveTo`, open a new one from the next day. History is then stable and correct
under both contracts, and this is what the app SHOULD steer the user towards.

**K9** — The same period being edited on two devices can produce an overlap after a
merge, even though each device's copy was valid. See 0012 M2.3; the merge surfaces
this rather than accepting it silently.

## Capacity computation

All derived, all at read time (CP1). Every function here takes dates and data as
parameters — no clock reads, no storage access (0002 A2).

### Expected hours for a date range

```
expectedMinutes(range):
  for each local calendar day d in range:
    period  = contractPeriodContaining(d)              // null → unknown
    if period is null: mark unknown; continue
    minutes = pattern.minutes[weekday(d)]
    if minutes == 0:                   contribute 0
    else if d is a whole non-working day: contribute 0
    else if d is a half non-working day: contribute minutes / 2
    else:                               contribute minutes
  if any day was unknown, the figure is unknown
```

**CP-A1** — The per-day loop is mandatory. Expected hours cannot be computed as
`range × minutesPerWeek / 7`, because the work pattern is not uniform across the
week and non-working days are not evenly distributed. That shortcut is wrong in
every real case.

**CP-A2** — Day boundaries MUST follow the browser's local timezone (0006 DT5),
consistent with day bucketing everywhere else in the app.

**CP-A3** — A range spanning two contract periods MUST be computed per period and
summed, with each portion attributed to its own contract. The app MUST NOT apply
one period's pattern to the whole range.

**CP-A4** — A half day's contribution MUST be computed in integer minutes, and a
pattern value that is odd MUST round half down with the remainder handled as an
explicit `unknownMinutes` count rather than being discarded. Two odd weekdays in a
range must not silently lose a minute each.

### Utilisation

```
worked   = sum(entry durations in range, excluding soft-deleted)
billable = sum(entry durations where resolved, rounded per 0006 RD2)
available = expectedMinutes(range)

hourUtilisation     = worked / available
billableUtilisation = billable / available
```

**CP-A5** — Utilisation MUST be expressed as a percentage to one decimal place,
derived from unrounded inputs.

**CP-A6** — When `available` is unknown or zero (K5), utilisation MUST render as
`—`, never `0%`, `100%`, `NaN` or `Infinity`.

**CP-A7** — Billable utilisation above 100% MUST still be shown exactly, with a
plain-language note rather than a cap or a warning colour. Billing more than
contracted hours is normal and profitable, not an error.

**CP-A8** — A day where entries overlap (0004 O2) may push worked minutes above
available minutes. This MUST render as-is, consistent with 0006 DT4.

## Reports added

**CR1 — Contract overview.** Current and historical contract periods, the work
pattern, and which applies today.

**CR2 — Expected vs actual.** Per week across a range: contracted, expected after
non-working days, actual worked, and the delta. The delta is what people want.

**CR3 — Utilisation.** Hour and billable utilisation per week, with the range
total.

**CR4 — Non-working days taken.** Grouped by `label` and by month. Free-text
labels group as-is (N5).

**CR5 — Calendar.** A month grid showing working days, non-working days and logged
time. This is the view that makes gaps visible.

**CR6** — Absent vs unlogged. Days inside a contract that are neither a
non-working day nor contain entries. Confirmed as wanted: this is the report that
finds time you neither worked nor accounted for, and it is the highest-value
output of the feature.

## Interaction with entries

**IE1** — Timer behaviour is unchanged. 0004 applies in full.

**IE2** — The entry list SHOULD mark entries recorded on a non-working day with a
subtle indicator, so an intentional exception is distinguishable from a mistake.

**IE3** — Reports MUST keep entry-only figures and capacity figures visually
separate. A total mixing worked hours with expected hours is meaningless.

## Deferred

- **`.ics` import.** Confirmed as later, not now. Needs a real parser and a
  date-time model that does not exist yet.
- **Holiday import from official sources** — government or standards-body
  publications. Manual entry is the supported path in this version. Note that such
  an import is a network fetch of *public* data the user initiates, so it is
  compatible with 0011 but does require adding the source's origin to `connect-src`
  (0011 N5).
- **`nth weekday of month` holidays**, e.g. US Thanksgiving (0003 NW8).
- **Leave allowance and entitlement.** Out of scope by decision. The app does not
  track how much annual leave someone is entitled to or has remaining. If this is
  later wanted it is a new entity and new reports, not an extension of this one.
- **Carry-over and accrual** — moot while allowance is out of scope.
- **Overtime, holiday pay and jurisdiction-specific rules.** Tax treatment of leave
  varies enormously by country and is not this app's problem.
- **Part-year pro-rata** on invoices, where a contract changed mid-period.

## Acceptance criteria

1. A 40-hour Mon–Fri contract yields exactly 2,400 expected minutes for a normal
   week.
2. Marking one of those days as a non-working day yields 1,920 for that week
   (N1).
3. A 37.5-hour Mon–Thu 480 / Fri 300 pattern produces the correct figure, and does
   NOT equal 2,250/7 per day (K2, CP-A1).
4. A Friday afternoon off removes half of Friday's contracted 300 minutes, not half
   of 480 (N8).
5. Leave spanning a non-working Saturday changes nothing (N2).
6. Two overlapping non-working day records produce the same result as one (0003
   NW5).
7. Utilisation renders `—`, not `0%` or `NaN`, when no contract covers the range
   (CP-A6).
8. A range spanning a contract change attributes each portion to its own contract
   (CP-A3).
9. An annual holiday with weekend substitution lands on the correct observed date
   in two different years where the weekday differs (0003 NW7).
10. A one-off non-working day never shifts (0003 NW10).
11. Non-working days never contribute to worked or billable totals (N3).
12. Absent-but-unlogged days are identified correctly (CR6).
