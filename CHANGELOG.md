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

## [0.1.0] - 2026-10-05

First release. Phases 1 to 4: a timer that survives a reload, duration-first entry
capture, day-grouped entries with totals, Dropbox sync across your own devices, JSON
backup and restore, and projects, clients and tags.

Reports, capacity planning and invoicing are not in this version — they are Phases 5
and 6, listed in [`SPECS/0014-development-plan.md`](SPECS/0014-development-plan.md).

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
- A header menu of named actions — settings, download, import, About — and a favicon beside
  the title linking home. About is also linked from settings, and reachable from anywhere via
  the menu, because "what is this, and is it safe to leave running?" is a question worth asking
  where the menu already is.

### Added — security and release gates

- A Content Security Policy, delivered as a `<meta http-equiv>` because GitHub Pages cannot
  set response headers. `connect-src` is limited to the provider's two API origins, which is
  the defence that matters most here: the database is the whole asset, and with no policy an
  injected string had a working channel to send it off-site. `script-src` is not relaxed —
  the one inline script, the theme bootstrap, is allow-listed by a hash computed from the
  built HTML at build time, so the two cannot drift apart.
- Two repository gates that fail `verify` and CI. One rejects any `VITE_*` variable whose
  name implies a secret, in source and in gitignored `.env` files alike; the other resolves
  every requirement citation in the source against the ids `SPECS/` actually defines. Ten
  citations had stopped resolving, and one pointed at a requirement in the wrong spec.
- The mutation gate now requires a _failed test_ rather than a non-zero exit. It had been
  counting a syntax error as coverage: one of its eleven mutations was not valid TypeScript,
  so `11/11` was eleven behaviours out of twelve. Four more mutations were added — local-write
  sync, the currency resolution chain, the empty currency selection and the running-entry
  edit — making it 18/18.

### Changed

- **Your preferences now follow you across devices.** The default currency, the currencies you
  work in, and the entries period were stored per browser, so a second device started from
  scratch and a restore did not bring them back. They now travel in the sync payload and in
  backups, merged by whichever device changed them most recently.

  Your theme stays on each device, because it has to be read before the page paints.

- **Clients and projects can no longer be deleted — they are archived instead.** Retiring a
  project is usually not a rare destructive act; it is a project that has finished. Offering
  both "archive" and "delete" meant the safe option got used less than it should have, because
  the destructive one looked like the official answer. Archiving changes nothing else: entries
  keep their project, projects keep their client, and nothing is removed. It asks for no
  confirmation, because there is nothing to warn about any more.
- An archived client or project is no longer offered as a choice — not on the timer card, not
  in the project picker, not as a client filter. An entry already filed under one still names
  it, marked archived, so historic work is not made to look uncategorised.
- Tags keep **Delete**, because deleting a tag moves entries (they lose the tag) rather than
  hiding one, so the affected count and the undo are still warranted.

### Changed

- The title carries a **dev** badge on any non-production origin, so a local build is not
  mistaken for the deployed one. It reflects the same check that decides which Dropbox app
  the origin talks to, so the badge and the sync target cannot disagree.

### Fixed

- **Stopping a timer no longer takes the screen away.** It used to jump straight to the
  entry form, which made one action — pressing Stop — look like three. The entry is written
  either way, so the offer to classify it is now a line on the timer panel with a link to the
  form, and it disappears when you start the next timer.

### Changed

- **A tag typed and then saved was silently lost.** Pressing Save moved focus off the tag
  field, which committed the name, and the form saved the entry before that commit finished —
  so the tag landed in the taxonomy attached to nothing. The field now clears only once the
  commit succeeds, and the form waits for it before writing.
- **A timer against a client's second project belonged to no one.** The running timer was
  attributed through the client's _default_ project rather than its own, so it appeared in an
  "uncategorised" row while a client was plainly selected. It also stopped filing against
  the right project after a project was added or removed, because the lookup was keyed on
  client ids that never change.
- **Stopping a timer twice raced the second stop against the first.** Two presses in one
  render pass both read the timer as running and both called `stopTimer`. The button is now
  disabled while the write is in flight.
- Rates were shown as the storage integer — "7500 minor units/hour" — and a project's row
  said only "billable" with nowhere to read the rate. Both are money now.
- Every new project and every new client opened as the same blue, and each new project reused
  the colour of the one before it, because the seed came from an empty list.
- "Show archived clients" also revealed archived projects: two labelled checkboxes bound to
  one value.
- **Restoring a backup was unreachable.** Both restore buttons were wired to a file input the
  hook did not own, so pressing one ran `null?.click()` and did nothing — no error, no
  change, no feedback. A backup could be downloaded and never put back. The whole import
  half of the backup format was dead in the running app.
- **An expired Dropbox sign-in showed a green "Synced".** The token was found unusable
  before any request, which was reported as "nothing to do" rather than as a failure, and the
  state that produced had no display — so the header claimed the work was on the other
  device when it was not, indefinitely, and the Connect button never came back.
- **A tag typed with a decomposed accent created a duplicate.** "Café" in two Unicode forms
  is two byte sequences; the comparison the tag path used did not normalise, so the second
  one became a second tag that renders identically and splits a filter. The one test of the
  Unicode rule compared a string with itself and passed either way.
- The entry list and the summary could disagree about the same day: one printed "cannot be
  computed" for an entry with an unreadable end while the other reported a confident total
  that quietly omitted it.
- If the database could not be opened at all, the entries view said "Loading…" for ever and
  suppressed the empty state, so a broken browser looked like a working empty one.
- The About page dropped the changelog's opening paragraphs entirely — while still shipping
  their bytes to every visitor — and split each wrapped paragraph into one block per source
  line, breaking sentences mid-clause.
- A failed backup restore was reported as "Could not read that file", sending the user to
  re-select a perfectly good backup when the real problem was the write.
- Archiving a project or client, changing the default currency, starting or discarding a
  timer, and stopping one all failed silently.
- A colour restored from a hand-edited backup was stored as-is and rendered as no swatch.
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

Fixes from the whole-repository review, which found four user-visible defects and
several silent ones:

- **Sync never ran after a local write.** The scheduler was started, debounced and tested, and
  nothing called it: "app open", "tab focus", "`pagehide`" and "Sync now" all worked, and
  recording an entry did not. Two devices open side by side stayed out of step for the whole
  session, and a closed laptop could sit on unsynced work for hours. The scheduler now
  subscribes to the storage layer's own change signal, so the trigger cannot be forgotten by a
  write path that does not know sync exists.
- **Unsynced work was invisible.** The sync indicator could not say "there is something
  waiting to go out". It now has a third state between "synced" and "failed".
- **Clearing the currency list emptied every picker in the app.** The panel says twice that
  clearing it returns the full ISO 4217 list; saving stored an empty list instead, which left
  each currency picker offering only the one currency that record already had.
- **A running entry could not be edited without stopping it.** Opening the pencil on a running
  entry and correcting a typo produced "Enter how long this took", because both the duration
  and the end field started empty. Saving without stating an end now leaves the timer running,
  and the form says that is what will happen.
- **A manual entry could be added while a timer was running**, which 0004 M4 forbids: the day
  total then counted the overlap twice. The new-entry screen now says a timer is running and
  offers to stop it, and never stops it on the user's behalf.
- **"Sync now" could report success while omitting the entry just added.** If another device
  wrote between our pull and our push, the retry merged the snapshot the cycle started with
  rather than the current data, so anything saved in between was not published. Nothing was
  lost — the next cycle picked it up — but the success message was not true of what you had
  just done.
- **The app-wide default currency was ignored in three places.** Each form resolved currency
  itself, ending at a hardcoded USD or GBP, so a rate stored in yen could be previewed in
  pounds. All three now use the one resolution chain, including the link to the default.
- **A backup truncated in transit imported as though it were complete.** The record counts
  were validated but never compared with what actually arrived, so a file cut short by a
  half-finished upload was accepted and silently dropped the rest.
- **Opening the edit form could overwrite a newer version of the same entry** — one changed by
  a sync merge or an undo in another tab — because the form keyed on the entry id alone.
- The token store no longer depends on Dropbox. It is a generic credential store, and the
  provider decides what its own tokens look like, so a second provider no longer means editing
  the storage layer.
- A storage read was started during render in the settings panel, and the same default-currency
  read had been copied into three components — where they had drifted into three different
  answers.
- The entry list read the whole database a second time on every write even when its caller had
  already loaded and filtered the list.
- The sync status dot for "waiting to sync" was below the 3:1 contrast that every other colour
  in the app is held to, and was not a token at all. All three status colours are now tokens,
  measured against both backgrounds and against the surface the dot sits on, by a test.
- Two design tokens were used in five places and defined nowhere, so every use silently fell
  back to a literal; a third was defined only for the dark theme. All are declared, and a test
  fails if a token is used without being declared.
- The per-entry edit button's styles were declared four times in thirteen lines, so the narrow
  layout could drift from the wide one without anything failing.
- A comment in the name-comparison code said the opposite of what the code did, on the
  question of Unicode normalisation — the kind of comment that makes a future reader "fix"
  correct code.
- The browser suite could silently test the wrong build. `--strictPort` makes its preview
  server exit rather than pick another port, and its output was discarded — so a port left
  held by an earlier interrupted run meant every check after that was a verdict on a stale
  `dist/` rather than on the build the run had just made. It now refuses to start and says
  how to clear the port.

### Changed

- Project names are unique **within a client** rather than across all projects. Every client
  can now have a project called `General`, which is what a per-client project list needs to
  read consistently. `SPECS/0005` P2 is revised with the reasoning.
- A new client's currency starts at the app default instead of a hardcoded GBP.
- An entry's duration carries seconds when it has any. A 25-second entry used to show as
  `00:00` on the edit page, and saving that wrote an entry of no length at all.
- Entry rows are compressed, with the pencil on the row's first line at the left-hand end.
- Import is merge-only. The spec required a "replace everything" mode; it is not implemented
  and is not planned, because it is the more dangerous of the two and the only mode whose cost
  is irreversible. `SPECS/0007` now records the reasoning. Anyone who wants it can export,
  clear site data and import — a path that requires naming the consequence.
- 0004 W2 no longer asks the browser's unload dialog to state the timer and its elapsed time,
  which no page can do; the requirement moved to the app's own UI, where it is met. The residual
  limitation is recorded rather than glossed.
- `SPECS/0002`'s directory tree and `0012`'s provider interface now match the code, with the
  reasoning for each divergence recorded in the spec.

### Known limitations

Recorded in full in [`SPECS/todo.md`](SPECS/todo.md).

- The app default currency, the chosen currencies and the entries period live in
  IndexedDB `meta`, which is in neither the sync snapshot nor a backup. They are
  device-local.
- The taxonomy undo window closes if you leave the settings view; the receipt is component
  state.
- The production Dropbox app has never been used, because its permissions have not been
  granted.
- `npm run dev` is not covered by the Content Security Policy. The policy is injected by the
  build, because the dev server rewrites `index.html` and injects its own inline preamble; a
  policy loose enough for the dev server would be no policy at all. The built site is what it
  protects.
- The policy cannot prevent clickjacking. `frame-ancestors` is ignored when a policy arrives
  via `<meta>`, and GitHub Pages cannot set response headers, so no framing defence is claimed.
- The browser's unload dialog has no text, because `beforeunload` cannot carry custom copy. The
  running timer and its elapsed time are shown in the page instead.
- The whole changelog is bundled into the JavaScript, which is 7 KB today and grows with
  every release. Kept deliberately: one source of truth, no `public/` copy to drift, and it
  works on a fork and offline. If it ever becomes measurable, the fix is to cap what is inlined
  rather than to add a second file.
- No coverage threshold and no pre-commit hook. CI runs `format:check`, `lint`, `test` and the
  two repository gates; the mutation gate is run deliberately on demand because it re-introduces
  bugs and re-runs the suite once per mutation.
