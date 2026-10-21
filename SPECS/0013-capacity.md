# 0013 — Contracted hours

**Status:** `Draft`
**Depends on:** 0003, 0004, 0006
**Amends**: 0001 (glossary), 0006 RP1

## What this is for

One question: **of the hours I am contracted to deliver, how many am I actually
delivering?**

Contracted hours are scoped to a client. A contract period says how many hours the
user expects to spend on one client in a week, and what shape that week has.
The scope is the client rather than the project, because a project's hours are
already a subset of its client's, and a project-level contract would double-count
against its own client. Project-level budgeting is not built.

The user calls this a "budget". The spec says "contracted hours" throughout and
the two mean the same thing.

The denominator is the contracted hours; the numerator is the time actually
tracked against that client. The comparison is per week, because a week is the
unit a contract is expressed in.

There is deliberately no leave entitlement tracking, and no non-working-day
entity — see §Non-working days for what replaces it and what that costs.

## The invariant this changes

0006 RP1 states that every report is computable **from entries alone**. That is no
longer true for capacity figures, and pretending otherwise would be the easy
mistake here. Entry-only reports are unaffected.

| Report | Inputs |
| --- | --- |
| Duration by project / client / tag (0006 R2, R3) | entries only |
| Billable summary (0006 R6) | entries only |
| Trends (0006 R4, R5) | entries only |
| Expected hours for a client | that client's contract periods |
| Utilisation for a client | expected hours + that client's entries |

**CP1** — All of these MUST still be computed at read time. Nothing is
precomputed, consistent with 0006 P2.

**CP2** — Absence MUST NOT be modelled as a `TimeEntry` of kind "leave". See 0003
§Capacity entities for the reasoning. The separation is load-bearing.

Absence is instead carried as an ordinary project — a client-less project named
for leave or non-work hours, with the time recorded against it as usual. That
satisfies CP2, which forbids a new *entry kind*: a project is a project. It has
two consequences worth stating, because they are visible in the numbers rather
than hidden.

- The leave project's time counts as **worked** time in every total, because it
  is an ordinary entry against an ordinary project. Nothing excludes it.
- It counts against **no client**, because it has none. So no client's
  expected-versus-actual comparison is affected by the user's own leave — which
  is the same outcome the original design produced, for a client whose work was
  not delivered.

A client whose own office closes for a fortnight has no way to have that
fortnight removed from its expectation. The expectation simply goes unmet, and
the utilisation figure says so.


## Non-working days

**Deferred — not built in this increment.** The `NonWorkingDay` entity (0003) is
not built, and the requirements below are recorded for a future increment rather
than implemented now. Absence is carried as an ordinary client-less project
instead; see CP2 for what that costs.

Two of these requirements are affected by the deferral in a way that matters:

- **N1** was the mechanism for reducing the denominator. Without it, expected
  hours are the contracted hours, full stop. A day the user did not work is
  simply a day the user did not work, and the gap shows in the utilisation
  figure rather than being explained away.
- **N8** (half days) and **CP-A4** (odd-minute handling) are the reason a
  contract pattern can produce a figure that is not a whole number of minutes.
  With no half days, every expected figure is a whole number of minutes and the
  `unknownMinutes` accumulator has nothing to accumulate.

The remaining requirements are unaffected by the deferral and are kept so that
citations to them resolve.

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

**K1** — Contracted hours are stored per `ContractPeriod` (0003), effective-dated
and scoped to a client. Confirmed necessary: hours change, and a single value
would make historical reports wrong from the day they did.

**K2** — The week MUST be expressible per weekday, because contracted hours are
rarely uniform. A 37.5-hour contract is commonly Mon–Thu 8h and Fri 5h, and
dividing by five gives the wrong expectation for every individual day. The common
case of even hours is a form shortcut (0003 CT7), not a separate model.

**K3** — Weekday indexing MUST be Monday-first, consistently everywhere: UI,
storage, reports, CSV and tests. JavaScript's `Date.getDay()` is Sunday-first and
is a reliable source of off-by-one bugs. This MUST be handled in exactly one place
in `domain/` and never inline.

**K4** — Contract periods MUST NOT overlap for the same client, and at most one
may be open-ended per client (0003 CT1). The app MUST refuse to create a second
open-ended period for a client rather than leaving the user to work out which
applies. Two *different* clients may each have an open-ended period: neither
speaks for the other's hours.

**K5** — If no contract period covers part or all of a report range for a client,
expected hours for that portion MUST be counted as **zero**, so the total can be
added up and compared with what was worked.

*Amended.* This used to make the whole figure **unknown**, and the reasoning was that
zero is a claim and "unknown" is the truth. But a report that cannot be summed
cannot be read: a period the contract only partly covered showed a dash for its
total, next to a per-week breakdown that had the covered weeks' figures in it, and the
two together said less than either alone. A dash is a number about a different thing.

The days that were not covered are still counted, so a report can say how much of the
period the contract had an opinion about — the distinction is kept where it is
informative and dropped where it is only obstructive.

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
this rather than accepting it silently. Because scopes are per client, the overlap
is judged within a client, so a merge that overlaps two *different* clients' periods
is not a conflict and MUST NOT be surfaced as one.


## Capacity computation

All derived, all at read time (CP1). Every function here takes dates and data as
parameters — no clock reads, no storage access (0002 A2).

### Expected hours for a date range

```
expectedMinutes(range, clientId):
  for each local calendar day d in range:
    period  = contractPeriodContaining(d, clientId)      // null → not covered
    if period is null: count as uncovered; contribute 0   // K5
    minutes = pattern.minutes[weekday(d)]
    if minutes == 0:                   contribute 0
    else:                               contribute minutes
  the total is the sum, and the count of uncovered days is reported alongside it
```

There is no non-working-day step, because the entity is deferred. Every expected
figure is therefore a whole number of minutes, and a day the user did not work
is a day that shows as unworked rather than as excused.

**CP-A1** — The per-day loop is mandatory. Expected hours cannot be computed as
`range × minutesPerWeek / 7`, because the work pattern is not uniform across the
week. That shortcut is wrong in every real case.

**CP-A2** — Day boundaries MUST follow the browser's local timezone (0006 DT5),
consistent with day bucketing everywhere else in the app.

**CP-A3** — A range spanning two contract periods for a client MUST be computed per
period and summed, with each portion attributed to its own contract. The app MUST
NOT apply one period's pattern to the whole range. A range spanning two *clients*
is two separate computations, not one: client scopes are disjoint, so their
expected hours MAY be summed for a range total.

**CP-A4** — **Deferred with the non-working-day entity.** A half day's
contribution is not computed, because half days are not recorded. Every expected
figure is a whole number of minutes and there is no `unknownMinutes` remainder
to carry. The requirement is kept for a future increment.

### Utilisation

```
worked   = sum(entry durations in range for this client, excluding soft-deleted)
billable = sum(entry durations where resolved, rounded per 0006 RD2)
available = expectedMinutes(range, clientId)

hourUtilisation     = worked / available
billableUtilisation = billable / available
```

`worked` is the time tracked **for this client**: entries whose project belongs
to it, or which name it directly. Time tracked against a client-less project —
the leave project, for instance — belongs to no client and appears in no
client's utilisation. That is the correct outcome, and it is also why the
app's overall hours-worked figure and the sum of the clients' figures differ
(IE3).

**CP-A5** — Utilisation MUST be expressed as a percentage to one decimal place,
derived from unrounded inputs.

**CP-A6** — When `available` is zero — which is what a period the contract does not
cover at all amounts to (K5) — utilisation MUST render as `—`, never `0%`, `100%`,
`NaN` or `Infinity`. There is no expectation to have a share of, so there is no
percentage to show; the expected and tracked figures beside it are still shown, so
the reader can see what happened.

**CP-A7** — Billable utilisation above 100% MUST still be shown exactly, with a
plain-language note rather than a cap or a warning colour. Billing more than
contracted hours is normal and profitable, not an error.

**CP-A8** — A day where entries overlap (0004 O2) may push worked minutes above
available minutes. This MUST render as-is, consistent with 0006 DT4.


## Reports added

Every report below is **per client**. A range total across clients is the sum of
the per-client figures, and is well defined, because client scopes are disjoint
(CP-A3).

**CR1 — Contract overview.** The current and historical contract periods for a
client, the work pattern, and which applies today.

**CR2 — Expected vs actual.** Per week across a range, for a client: contracted,
expected, actual worked, and the delta. The delta is what people want.

**CR3 — Utilisation.** Hour and billable utilisation per week for a client, with
the range total.

**CR4 — Non-working days taken.** **Deferred with the non-working-day entity.**
Grouped by `label` and by month. Free-text labels group as-is (N5).

**CR5 — Calendar.** A month grid showing the client's working days and the time
logged against them. This is the view that makes gaps visible.

**CR6 — Absent vs unlogged.** Days inside a client's contract that contain no
entries for that client. Confirmed as wanted: this is the report that finds time
you neither worked nor accounted for, and it is the highest-value output of the
feature. Without the non-working-day entity there is no way to distinguish
"not worked" from "excused", so every such day appears here.

## Interaction with entries

**IE1** — Timer behaviour is unchanged. 0004 applies in full.

**IE2** — The entry list SHOULD mark entries recorded on a non-working day with a
subtle indicator, so an intentional exception is distinguishable from a mistake.
**Deferred with the non-working-day entity** — there is no non-working day to
mark.

**IE3** — Reports MUST keep entry-only figures and capacity figures visually
separate. A total mixing worked hours with expected hours is meaningless.


## Deferred

- **The `NonWorkingDay` entity** (0003), and with it N1–N9, CR4, IE2 and CP-A4.
  Absence is carried as an ordinary client-less project instead. The cost is
  stated in CP2: a client's own closures cannot be excused from its expectation,
  and a day the user did not work is indistinguishable from a day they were on
  leave. This is a simplification, and it is the user's choice — but it is
  recorded here so the difference is visible later rather than rediscovered.
- **Project-level contracts.** The scope is the client. A project's hours are
  already a subset of its client's, so a project-level contract would
  double-count against its own client.
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

1. A 40-hour Mon–Fri contract for a client yields exactly 2,400 expected minutes
   for a normal week.
2. A 37.5-hour Mon–Thu 480 / Fri 300 pattern produces the correct figure, and does
   NOT equal 2,250/7 per day (K2, CP-A1).
3. Utilisation renders `—`, not `0%` or `NaN`, when no contract covers the range
   (CP-A6).
4. A range spanning a contract change attributes each portion to its own contract
   (CP-A3).
5. Two clients may each hold an open-ended period without either conflicting
   (K4).
6. Expected hours for a client with no contract covering part of the range count as
   zero for that portion, and the total can still be added up (K5).
7. Time tracked against a client-less project appears in no client's utilisation
   (CP2).
8. Absent-but-unlogged days are identified correctly for a client (CR6).
9. Weekday indexing is Monday-first in every code path (K3).

