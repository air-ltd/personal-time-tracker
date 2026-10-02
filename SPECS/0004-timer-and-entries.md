# 0004 — Timer and time entries

**Status:** `Draft`
**Depends on:** 0003

## Timer lifecycle

States: `idle` → `running` → `idle`.

| Transition | Trigger | Effect |
| --- | --- | --- |
| `idle` → `running` | User clicks Start | Create entry with `start = now`, `end = null`, `source = timer` |
| `running` → `running` | User clicks Start again | No-op. MUST NOT create a second entry |
| `running` → `idle` | User clicks Stop | Set `end = now`, open the detail form |

**T1** — Starting a timer MUST be a single click and MUST persist immediately.
The entry is written to storage before the UI is updated, so a crash between
click and paint cannot lose the start.

**T2** — While running, the UI MUST display the elapsed duration, derived from
`now`, updating at least once per second.

**T3** — Stopping MUST capture `now` once and use it for both the displayed
duration and the persisted `end`. Recomputing from a later tick would silently
add or lose a second.

**T4** — At most one timer runs at a time, globally, enforced by E4 in 0003.

**T5** — If a running entry exists on load, the app MUST resume showing it as
running. This is the normal case after any page reload.

**T6** — The user MUST be able to discard a running entry. This stops the timer
and soft-deletes the entry (0003 D1). Offered as "discard" alongside "stop", so
a mis-click that was not real work leaves no zero-value record.

## Timer durability

This is the most consequential decision in the spec, so it is called out
explicitly. Resolved: the timer continues running, and the user is warned on
attempted close.

**D1** — The timer is a wall-clock span, not a counter. Duration is always
`now - start`. Nothing accumulates.

**D2** — Consequence: **the timer keeps running when the tab is closed and when
the browser is shut down.** Because duration is derived from timestamps, a
timer started before a reboot will report the full elapsed span including time
the machine was off.

This is deliberate. An alternative design pauses on page unload, but it means
closing a laptop lid truncates the session, and it makes the behaviour depend on
the browser rather than on the data. The honest reading of "I worked on this from
2pm to 5pm" is the wall-clock span.

**D3** — Because of D2, an entry spanning machine downtime MUST be reviewable.
The detail form MUST surface the duration prominently before save, so a
three-hour entry covering an overnight gap is noticed.

**D4** — The app SHOULD offer a "trim" affordance on a long running entry to
shorten it to the plausible portion. Out of scope to automate; manual editing
covers it.

## Closing the tab while running

Resolved: warn, and **default to continuing**.

**W1** — When a timer is running and the user attempts to close the tab, close the
window, or navigate away, the app MUST prompt for confirmation.

**W2** — The prompt MUST state that a timer is running and how long it has been
running, so the user can tell a deliberate session from a forgotten one. A bare
"are you sure?" gets dismissed without reading.

**W3** — **Continuing to run is the default outcome.** Dismissing the prompt, or
confirming the leave, MUST both leave the timer running. Leaving must never stop
the timer — that would silently discard elapsed time, which contradicts D1.

**W4** — Only `beforeunload` can produce a blocking prompt, and only with
browser-native chrome. The app MUST NOT attempt a custom modal in this path: the
browser will not show it, and the attempt may break the real one.

**W5** — The prompt MUST NOT be registered when no timer is running. A permanent
handler would prompt on every single navigation for no reason, and teaching the
user to dismiss it reflexively would defeat W1 when it actually matters.

**W6** — The prompt MUST be suppressible for the current timer once the user has
confirmed they meant to leave. Otherwise navigating to the reports view while a
long session runs becomes an obstacle on every click. The affordance MUST be
explicit and MUST reset on the next timer start.

### Known limits of W4, stated rather than hidden

These are platform constraints, not implementation gaps:

- **`beforeunload` is advisory.** Browsers show their own generic wording; the app
  cannot customise the text, only trigger the dialog.
- **Suppression without prior interaction.** Some browsers only honour
  `beforeunload` when the user has interacted with the page. A timer started but
  never clicked again may close without a prompt. The app MUST NOT treat the
  prompt as a guarantee.
- **iOS Safari does not support it.** On iOS the prompt will simply not appear.
  Since a timer keeps running regardless, this degrades to the 0004 D2 behaviour
  rather than to data loss.
- **Consequence:** the timer being a wall-clock span (D1) is what makes all of this
  survivable. Nothing is lost if the prompt never fires.

**W7** — `pagehide` MUST also be handled, not just `beforeunload`. It is the more
reliable of the two across mobile browsers, and it is the last reliable moment to
flush a pending sync (0012 C1). This is a correctness requirement, not a
best-effort optimisation.


## Manual entries

**M1** — The user MUST be able to create an entry with an explicit start and end,
source `manual`, at any past date.

**M2** — Manual creation MUST support: start, end, project, tags, note, billable,
rate override.

**M3** — For manual entries the primary input SHOULD be a duration plus a start
time, since that is how people actually recall work ("about three hours, started
after lunch"). A raw end-time field MUST also be available. Both MUST normalise to
the same stored `start`/`end` pair.

**M4** — A manual entry MUST NOT be created while a timer is running. The UI MUST
prompt to stop the timer first, since 0003 E4 allows only one open-ended entry.
The app MUST NOT silently stop the running timer on the user's behalf.

## Validation

Applied to every entry, regardless of source:

- **V1** — `end` is required and strictly after `start`.
- **V2** — Maximum duration is 24 hours. A longer span is rejected with an
  explicit message, since it almost always means a typo or an unattended timer.
- **V3** — `start` MUST not be in the future beyond a small tolerance
  (5 minutes) to absorb clock skew.
- **V4** — Project required unless the user explicitly chooses uncategorised.
- **V5** — The app SHOULD warn, not block, on a duration over 12 hours, because
  the 24-hour cap already caught the gross errors.

## Editing and deletion

**ED1** — Every entry MUST be editable after creation, including a running one.
Editing a running entry's `start` re-anchors the live duration.

**ED2** — Editing `end` on a running entry MUST stop it.

**ED3** — Deleting MUST be soft, with an undo affordance (0003 D1–D3).

**ED4** — Editing an entry MUST NOT change other entries. Overlap with another
entry is allowed and merely flagged.

## Overlaps

Entries are independent spans. Overlap is permitted because real work
interleaves, and silently merging or rejecting data would be worse than showing
the overlap.

- **O1** — The app MUST NOT reject, clip, or auto-merge overlapping entries.
- **O2** — Report totals MUST sum entry durations without de-duplicating
  overlapping time. A day that totals more than 24 hours is a data problem the
  user should see, not one the app should hide.
- **O3** — The entry list SHOULD mark overlapping entries visually.
- **O4** — The 24-hour cap (V2) is per entry, not per day. Daily totals above 24
  hours are permitted.

## Entry list

**L1** — The list MUST be grouped by local calendar day, newest first, with a
per-day subtotal.

**L2** — Each row MUST show project colour and name, start–end wall-clock range,
duration, tag names, and a billable marker.

**L3** — The list MUST support filtering by project, client, tag, billable state,
source, and free-text note.

**L4** — A day with no entries MUST be visible as an empty group or omitted
consistently. Omission is preferred, with a separate explicit view for gaps.
