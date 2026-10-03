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
4. [ ] **Need ability to categorise by job/client.** In progress in `phase-4`. The data
   layer is done and committed: schema v3, the taxonomy repository, and the rate and
   currency resolution chains. What remains is the UI — a settings view for project and
   client CRUD, and a project picker on the entry form. Storage can already create,
   archive, delete and merge, so the rules are enforced and tested; nothing is reachable
   by clicking yet.
5. [ ] **Within a job/client have projects.** Same position as item 4. `Project.clientId`
   exists and is tested, and deleting a client clears it on its projects rather than
   removing them. Needs the same UI.
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

1. [ ] Settings view for project and client CRUD (0005 P1).
2. [ ] Colour picker over the computed palette, with the measured contrast shown when a
   user overrides it (0005 P3–P4).
3. [ ] Project picker on the entry form, grouped by client, with the uncategorised option
   labelled rather than shown as "Unknown" (0005 U1, N2).
4. [ ] Inline tag creation in the entry form, reusing an existing tag on a
   case-insensitive match (0005 T1–T2).
5. [ ] Tag management with merge (0005 T4).
6. [ ] Delete confirmations showing the affected entry count and billable hours, with a
   stronger second confirmation when billable entries are involved (0005 X1–X3).
7. [ ] "Show archived" control, so historical entries stay editable (0005 A2).
8. [ ] Phase 4 gate: deleting a project leaves its entries intact and unprojected with a
   count shown; archiving preserves historical entries and their colours.

## Phase 5 onwards

Per `0014-development-plan.md`. Not started.

## Notes worth keeping

1. [ ] The six silent failures that cannot be checked yet — rounding, float drift,
   utilisation divide-by-zero, weekday off-by-one, breakdown reconciliation and CSV
   quoting — all need Phase 6 arithmetic that does not exist. `scripts/check-silent-failures.mjs`
   lists them as pending with the phase that introduces them. Run
   `npm run check:silent` after touching anything in `domain/`, `storage/` or `sync/`.
2. [ ] `npm run test:e2e` is **not** part of `npm run verify`. It needs a built site and a
   browser, so it has to be run deliberately. Playwright's browsers need installing once
   with `npx playwright install chromium`.

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