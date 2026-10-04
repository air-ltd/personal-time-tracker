# User-requested items

Numbered, not bulleted. Ordered roughly by when they came up.

1. [x] Timer accuracy on front screen always to the second. Done in `phase-2b`: the
   running timer shows `H:MM:SS`.
2. [x] Timer accuracy on save screen to the second. Done in `phase-2b`: the form's
   duration preview shows `H:MM:SS` alongside the rounded minutes.
3. [ ] **stop should just stop and save, not present another screen.** Still open. The
   timer already stops and saves, but `App.tsx` navigates to a form afterwards; the fix
   is to save and stay put. Note this interacts with item 5 — the modify-after-the-fact
   affordance is what makes skipping the screen safe.
4. [x] **Need ability to categorise by job/client.** Done in `phase-4`, though the branch is
   still uncommitted. A `#/settings` view reachable from the header in one click (two
   interactions to any record, 0005 P1), a project picker on the entry form grouped by
   client, and entries naming their project, client and tags in the list.
5. [x] **Within a job/client have projects.** Done alongside item 4. `Project.clientId` is
   set from the picker, deleting a client clears it on its projects rather than removing
   them (0005 X4), and a project left without a client stays selectable so its entries
   remain editable.
6. [x] Dropbox key given in the browser, with the setup instructions in-app. Done in
   `phase-2b`, then revised: both Dropbox keys are now built in and chosen by host, a
   stored key is ignored and cleaned up, and the Sync panel shows the key in use plus the
   exact redirect URI. A browser-entered key was only ever a way to avoid a rebuild, and
   keeping it let a stale value pair with the wrong Dropbox app — which is what caused
   `invalid_redirect_uri`.
7. [x] Connecting to Dropbox appeared to work, then said "not connected". Done in
   `phase-2b`. Two bugs, both reproduced before fixing: the PKCE verifier lived only in
   memory and was gone when the OAuth redirect reloaded the page, and the Sync panel read
   the token store before the exchange finished.
8. [x] Deleting an entry did not reach Dropbox. Fixed in `phase-2b`. The sync engine
   decided "nothing to publish" from the remote revision alone, which cannot distinguish
   "nothing happened anywhere" from "only this device changed" — so *every* local edit and
   addition had also never synced, not just deletions.
9. [x] light/dark mode settings should be under the settings page. Done: the three-way
   radio group moved off the header, which had carried it on every screen for a preference
   nobody changes mid-entry.
10. [x] dropbox connection status should be indicated in the header row, and details moved
    to settings page. if disconnected the header row indicator should be a buttons that allows
    connection to be triggered. Done. The indicator changes shape with the state rather than
    being one control meaning different things: disconnected is the button that connects,
    because that is when there is something to act on. The connection moved into one
    provider at the app root, because the header and the settings page must not own it
    separately — the provider caches a single PKCE verifier, so two owners could start an
    authorisation neither could finish.
11. [x] "Time Tracker" in the header should be a link that takes user to "personal-time-tracker"
    page. Done, and then revised by item 15.
12. [x] the "TIMER" box should allow starting a timer for each client, and should include a
    button to create a new client & buttons to edit a client - every client gets a default
    project and as default the time should be recorded against that project. Done. One
    button per client, and the client's default project is created with the client so the
    button has somewhere to record. A client whose project is missing still starts a timer,
    recorded uncategorised, because refusing would lose the work.
13. [x] allow user to select relevant currencies and hide others. Done: over 180 ISO 4217
    entries were offered in every picker, and the user can now keep the relevant ones. Stored
    in `meta` rather than `localStorage`, which 0011 R5 reserves for the theme alone.
14. [x] make the currency selection list a collapsable display, and default collapsed. The
    selected currencies should be grouped at the top of the list. Done. Collapsed by
    default, because the list is 180-odd entries and the usual case is a user who has
    already chosen. What is chosen stays visible while collapsed, since that is the one
    question that must be answerable without expanding anything.
15. [x] link on "Time Tracker" should be relative to current web-site. Done, and it
    corrects item 11: the first attempt resolved the link to the deployed host, which sent
    a fork — or a local `npm run dev` — off to somebody else's site. Derived from the
    current origin plus the configured base instead.
16. [x] layout for "TIMER" section - each client should have a single line, with "new
    client" as a + button in top right corner. there should be no "no client option". along
    with the name of the client, there should be a total (summed) time that has been tracked
    under that client. Done, with two caveats worth recording. The no-client button is gone,
    but a plain Start remains while there are no clients at all, or the panel would have
    nothing to start a timer with. And uncategorised stays a legitimate state (0005 U1/U2)
    reachable from the manual entry form — the timer is simply not where you choose it.
17. [x] can you use this icon for the "Connect Dropbox" — a cloud is now drawn inline. The
    flaticon artwork itself was **not** downloaded: it is third-party with its own licence
    and attribution terms, and shipping a guess at what it looks like would be worse than
    shipping something plainly ours. Swapping in the exact artwork is a one-line change in
    `src/app/Icons.tsx`: keep the `viewBox`, replace the paths.
18. [x] backup & recovery actions should be on an hamburger menu with "settings". Done, and
    the panel is only mounted while the menu is open — backup reads the stored snapshot on
    mount, so leaving it on the page meant doing that work on every load to show something
    nobody asked for.
19. [x] starting a timer should not significantly change the layout of the timer card, show
    the count up on the line for the client, and indicate that one is active. does not need
    the "no timer running" text if no timer is active. Done: the client list is rendered
    once and the running state is expressed on the active client's own line, so nothing
    below the panel moves. Other clients' Start buttons are disabled rather than hidden —
    one timer at a time (0004 T2), and a control that vanishes cannot be learned.
20. [x] can you compress the entries layout a bit - info and edit button should be on the
    same line. edit button should be replaced with an icon rather then the word "edit".
    Done. The edit control is a pencil with an `aria-label` naming the entry it edits, so it
    is still reachable by name rather than by guessing which icon is which. A long note
    still gets its own line: it is the length, not the fact of a note, that earns the space.
21. [x] ability to select a client and have entries filtered by that client (this does not
    necessarily start a timer). If a timer is active for a client the entries should be
    filtered for that client. Done, and the second sentence is the interesting one: a
    running timer **overrides** the selection, because a timer is an assertion that the user
    is working for that client right now. The control says which client is filtering and
    why, rather than the list changing silently. Starting a timer does not select a client.
22. [x] entries to have a "period setting": daily, weekly, all entries - daily and weekly
    should cause it to summarise to that level per client. Done. It defaults to **all**, so
    the home screen still shows the day-grouped list 0004 L1–L2 asks for and the empty state
    (0007 FB3) is not hidden behind a summary reading "nothing in this period".
23. [x] a larger version of favicon should be to the left of the title "Time Tracker" -
    this icon should be link to the basic page. Done.
24. [ ] timer card doesn't need the text clients, please remove and then compress a little further.
25. [ ] selection of client for entry filter should be based on clicking on the client in the timer card. daily/weekly/all selection should be in the header row with entries. Entries card should be collapsable,
26. [ ] hamburger menu needs tidy up - it doesn't need all the text, just the 3 buttons which should be arranged vertically.

# Where the branches are

- `phase-2a` — basic end-to-end: timer, entries, storage, list. PR #3 open.
- `phase-2b` — Dropbox sync, merge, backup. Complete and committed; **not pushed**.
- `phase-3` — test suite. Complete and committed; folded into the `phase-4` branch's
  history, since each phase branches from the previous phase's head.
- `phase-4` — taxonomy. **In progress.** Current branch.

## Outstanding on `phase-2b` and `phase-3`

1. [ ] **Push the branches.** The token available here cannot write to the repository, so
   `phase-2b`, `phase-3` and `phase-4` are all local only.
2. [ ] **Production Dropbox app is untested.** The production app
   (`gh3s5cqaz4n30ah`) still has neither `files.content.read` nor
   `files.content.write` ticked, so nothing has ever synced against it. The non-production
   app is configured and working.

# What is next

## Phase 4 — Taxonomy

1. [x] Settings view for project and client CRUD (0005 P1).
2. [x] Colour picker over the computed palette, with the measured contrast shown when a
   user overrides it (0005 P3–P4).
3. [x] Project picker on the entry form, grouped by client, with the uncategorised option
   labelled rather than shown as "Unknown" (0005 U1, N2).
4. [x] Inline tag creation in the entry form, reusing an existing tag on a
   case-insensitive match (0005 T1–T2).
5. [x] Tag management with merge (0005 T4).
6. [x] Delete confirmations showing the affected entry count and billable hours, with a
   stronger second confirmation when billable entries are involved (0005 X1–X3).
7. [x] "Show archived" control, so historical entries stay editable (0005 A2).
8. [x] Phase 4 gate: deleting a project leaves its entries intact and unprojected with a
   count shown; archiving preserves historical entries and their colours.

Gated by 631 unit tests across 37 files and 44 browser checks, all passing.

## Phase 5 onwards

Per `0014-development-plan.md`. Not started.

## Notes worth keeping

1. [ ] The six silent failures that cannot be checked yet — rounding, float drift,
   utilisation divide-by-zero, weekday off-by-one, breakdown reconciliation and CSV
   quoting — all need Phase 6 arithmetic that does not exist. `scripts/check-silent-failures.mjs`
   lists them as pending with the phase that introduces them. Run
   `npm run check:silent` after touching anything in `domain/`, `storage/` or `sync/`.
2. [x] `npm run test:e2e` is still **not** part of `npm run verify` — it needs a browser, so
   it stays a deliberate step. Playwright's browsers need installing once with
   `npx playwright install chromium`. It now really does build first, rather than only
   logging that it is about to: `vite preview` serves whatever is in `dist/` and compiles
   nothing, so the script was testing the last build that happened to succeed. That made a
   genuine fix look broken twice, because the browser was faithfully running the previous
   code. Worth remembering when a browser check fails after a change that should have fixed
   it.
3. [ ] **The app default currency is device-local.** It lives in IndexedDB `meta`, and `meta`
   is excluded from both sync and backup, so a second device does not inherit it and a
   restore does not bring it back. Deliberate for now: it is a display preference, not
   data. If it ever becomes something a user would be upset to lose, it has to move into
   the snapshot like everything else.
4. [ ] **The taxonomy undo window closes when you leave the settings view.** The receipt is
   component state, so navigating away discards it and the deletion stands. The entry undo
   bar in `App.tsx` survives navigation because it lives at the app level; moving the
   taxonomy one up would need the receipt held outside `TaxonomySettings`.
5. [ ] Two layout bugs of the same shape are worth remembering because neither is visible
   to jsdom: the rate and colour feedback lines used to appear on blur, which moved the
   button under the pointer mid-click, so **clicking Save straight after typing a rate did
   nothing**. Both lines now hold their height permanently. Any new field that swaps its
   own height on focus loss will reintroduce it.
6. [x] **Project names are now unique within a client, not across all projects**
   (0005 P2, revised; see 0005 and 0003). This removes the suffixing that "every client
   gets a default project" had forced — every client now has a project called `General`.
7. [ ] **Weeks start on Monday, and Sunday is the trap.** Mapping Sunday to 0 rather than 7
   makes every Sunday land eight days early and every week one day too long.
8. [ ] **A Dexie transaction fails if it touches a store it did not declare**, and says
   `NotFoundError: ... an object store did not exist` rather than mentioning the
   transaction. `createClientWithDefaultProject` hit this by wrapping two helpers that each
   read more than the two stores being written. Declare every store the body can reach.

# External review

A review by another agent, working without knowledge of recent work, found 25 issues.
Every claim was checked against the code before acting; all of them were real.

## Fixed

1. [x] `dexie` was a devDependency although imported at runtime, so `npm ci --omit=dev`
   could not build a production site.
2. [x] `writeSnapshot` opened one transaction per table while its comment claimed a
   single one. A partial write would have left a mixture of two snapshots for the next
   sync to publish.
3. [x] The sync engine wrote locally before repairing references, so the database and the
   remote never matched and every later cycle pushed a redundant correction.
4. [x] Stopping the timer navigated before the write landed, rendering "Entry not found"
   permanently for an entry that had in fact been saved.
5. [x] `useEntries` reported loading on every write, flashing "Loading…" over a correct
   list.
6. [x] `EntryForm` took `now` as a prop and ignored it, reading the clock three times
   instead — so time-relative validation was not testable.
7. [x] `decodeURIComponent` threw on a malformed hash escape, crashing the app.
8. [x] Deleting a project advanced `updatedAt` on already-deleted entries, letting a
   tombstone win a merge tie it should have lost.
9. [x] `EntryList`'s day heading threw on a corrupt day key, taking down the whole list.
10. [x] `scheduler.log()` hardcoded `level: 'warn'`.
11. [x] The engine called `readLastRev()` each cycle and discarded the result.
12. [x] `DROPBOX_REDIRECT_PATH` was exported, misnamed, dead, and the redirect URI was
    built in two places.
13. [x] The browser suite compared elapsed times lexicographically, which breaks at ten
    hours.
14. [x] `repairReferences` mutated its input, which is how issue 3 happened.
15. [x] The entry row overflowed a 320px viewport.
16. [x] The setup docs and `.env.example` described app-key precedence the code no longer
    implements.
17. [x] The README still said "No code yet".
18. [x] `refreshToken` and `displayName` were stored but never used.
19. [x] The snapshot bridge listed two tables that do not exist.
20. [x] Vitest's globals were in the app tsconfig, putting `describe` and `expect` in
    scope for production code.
21. [x] The deployed redirect URI was written out in full, so a rename would have left the
    setup panel telling users to register a URI that no longer existed.
22. [x] A duplicate step number in the browser suite, introduced here rather than by the
    reviewer.

## Accepted rather than changed

1. [ ] `listEntries` loads all rows and filters in JavaScript. IndexedDB cannot index
   `null`, so the obvious index is unavailable for the active-entry query, and a full scan
   is imperceptible at the confirmed volume. Revisit if entry counts reach tens of
   thousands, where the exit is an indexed numeric flag.
2. [ ] The production Dropbox app has still never been used. Nothing in the repository can
   change that; it needs the permissions ticked and an authorisation.
