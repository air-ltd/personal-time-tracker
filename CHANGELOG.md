# Changelog

All notable changes to this project are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Versioning

Versions are cut at **release**, not per phase. Everything below `Unreleased` is work that
exists on a branch but has not shipped, so it has no version yet — a phase boundary is a
development convenience, not something a user of the app can observe.

Pre-1.0, so `0.x.y`: the minor digit moves when something users depend on changes or
breaks, and the patch digit for fixes within that.

## [Unreleased]

Nothing has been released yet. This is the first release candidate.

### Added — timer and entries (Phase 2A)

- A timer that survives a reload, showing elapsed time to the second. Elapsed is derived
  from timestamps on every tick and never accumulated, which is what lets it survive being
  closed and reopened.
- Duration-first manual entry, because "about three hours, starting after lunch" is how
  people recall work. An explicit end time remains available for entries known by their end.
- Validation that reports future starts and implausibly long entries against a fixed `now`
  rather than the wall clock, so the rules are testable.
- Entries grouped by local day with per-day subtotals. The subtotal is the sum of the rows
  beneath it, so the two cannot disagree. Overlapping entries are both counted — a day
  reading more than 24 hours is a data problem the user should see.
- A local timezone day boundary throughout, built from local date components rather than by
  adding milliseconds, so a day on a DST transition is still 24 hours of wall clock.
- Soft delete with undo, so an accidental delete during review costs one keystroke.

### Added — sync, merge and backup (Phase 2B)

- Dropbox sync, with both app keys built in and selected by host. A key stored in the
  browser is ignored and cleaned up; it could pair a stale value with the wrong app, which
  is what produced `invalid_redirect_uri`.
- A merge engine for when two devices wrote while apart. Every claim in it is tested
  against a specific failure, including three ways the naive version looks right and loses
  something.
- JSON backup and restore. A backup is the only copy of the data that does not depend on a
  third party, so it is available whether or not sync is.
- Repair of references arriving from another device, made pure so it cannot mutate its
  input — which is how a whole class of divergence was originally caused.

### Added — test suite (Phase 3)

- 719 unit tests over 42 files, plus a mutation-based silent-failure gate that must catch
  every planted defect.
- A browser suite of 75 checks against the built site. It exists because jsdom has no
  layout engine: whether a control overflows 320px, whether an icon has any painted
  geometry, and whether focus landed are all invisible without a real browser, and each of
  those hid a real defect.
- The browser suite builds the site itself. It used to log that it was about to and then
  serve whatever was last in `dist/`, which made a genuine fix look broken twice.

### Added — projects, clients and tags (Phase 4)

- A settings view for project and client CRUD, reachable in one click from the header. A
  missing project blocks entry capture, so creating one must never require abandoning the
  timer.
- A project picker on the entry form, grouped by client, with uncategorised as a labelled
  state rather than an absent selection.
- Tags created inline while recording. Inventing a taxonomy in advance is not how tagging
  works, and a user who has to stop and design one will not record the entry.
- Deleting a project keeps its entries, clears their project, and states the affected count
  and billable hours first — with a second confirmation when billable time is involved,
  because those figures cannot be recovered from a later "where did that go".
- Archiving that hides a record from pickers and leaves it selectable, so historical entries
  stay editable.
- Undo for taxonomy deletions, restoring the record _and_ the references the deletion
  cleared.
- Per-client timers: one button per client, each starting against that client's default
  project, with the time recorded against that client shown alongside.
- Client selection by pressing the client on the timer card, filtering the entries below.
  A running timer overrides the selection, and says so.
- Daily, weekly and all-entries views, summarising per client, and remembered between
  sessions.
- Currency narrowed to the ones the user bills in, behind a collapsed list.
- Colours from a fixed accessible palette, with the measured contrast shown when a colour
  is overridden — reported whether it passes or fails.

### Added — interface

- Settings page carrying theme, taxonomy, currencies, sync and backup.
- Sync status in the header, with the detail on the settings page. When disconnected the
  indicator is the button that connects.
- A header menu of three named actions, and a favicon beside the title linking home.

### Changed

- Project names are unique **within a client** rather than across all projects. Every client
  can now have a project called `General`, which is what a per-client project list needs to
  read consistently. `SPECS/0005` P2 is revised with the reasoning.
- A new client's currency starts at the app default instead of a hardcoded GBP.
- An entry's duration carries seconds when it has any. A 25-second entry used to show as
  `00:00` on the edit page, and saving that wrote an entry of no length at all.
- Entry rows are compressed, with the pencil on the row's first line at the left-hand end.

### Fixed

- A timer could be started against no project at all while the client's default project was
  still being read, recording the time uncategorised with nothing to indicate it.
- Undo of a taxonomy deletion wrote correctly but never notified views, so the restored
  record stayed invisible until an unrelated write nudged the list.
- Deleting a taxonomy record left the list showing it, for the same reason.
- `UndoBar` ran the _undo_ on its own ten-second timeout, so deleting an entry and walking
  away silently brought it back.
- The browser suite served a stale bundle while claiming to have built.
- Clicking Save immediately after typing a rate did nothing: the feedback line appeared on
  blur and moved the button out from under the pointer.

### Known limitations

Recorded in full in [`SPECS/todo.md`](SPECS/todo.md).

- The app default currency, the chosen currencies and the entries period live in
  IndexedDB `meta`, which is in neither the sync snapshot nor a backup. They are
  device-local.
- The taxonomy undo window closes if you leave the settings view; the receipt is component
  state.
- The production Dropbox app has never been used, because its permissions have not been
  granted.
