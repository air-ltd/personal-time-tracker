# User-requested items

Numbered, not bulleted. Ordered roughly by when they came up.

1. [x] Timer accuracy on front screen always to the second. Done in `phase-2b`: the
   running timer shows `H:MM:SS`.
2. [x] Timer accuracy on save screen to the second. Done in `phase-2b`: the form's
   duration preview shows `H:MM:SS` alongside the rounded minutes.
3. [x] **stop should just stop and save, not present another screen.** **Done by item 48.**
   Stopping writes the entry and stays where you are; the form is offered as a link on the
   timer panel rather than imposed as a navigation. That is also the affordance this item
   said the change depended on — the entry is not stranded uncategorised, it is one click
   away from being described, and the entry list reaches it too. `0001 US2` amended.
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
    (0007 FB-3) is not hidden behind a summary reading "nothing in this period".
23. [x] a larger version of favicon should be to the left of the title "Time Tracker" -
    this icon should be link to the basic page. Done.
24. [x] timer card doesn't need the text clients, please remove and then compress a little
    further. Done. The heading was the one line naming nothing the user did not already
    know — the rows are buttons labelled with client names — and it cost a whole row of
    height. Rows are tighter, and the add button is the only thing in the header.
25. [x] selection of client for entry filter should be based on clicking on the client in the
    timer card. daily/weekly/all selection should be in the header row with entries. Entries
    card should be collapsable. Done, and the first clause removes a question the app was
    asking twice: the user identifies a client by pressing its timer button, then had to say
    the same name again in a dropdown. Pressing a client now toggles it — it is a toggle
    rather than a radio so there is a way back to "all clients", which with no dropdown is
    the only way back. The selection lives in `App`, because two cards act on it.
26. [x] hamburger menu needs tidy up - it doesn't need all the text, just the 3 buttons which
    should be arranged vertically. Done: three buttons, stacked, with the explanatory
    paragraphs gone. They moved to the settings page, which has room for them — a menu has
    nowhere to say that restoring merges rather than replaces, and that sentence is why the
    buttons are safe to press. The two surfaces share one `useBackup`, so they cannot
    disagree about what "restore" means.
    **Now four buttons**: About was added to the menu later, at your request, which reverses
    the count half of this item and nothing else. It is still a menu of named actions with no
    explanatory text. What item 26 actually settled was that a menu has nowhere to explain a
    button, so the backup explanation stays on settings; About is the one entry that earns its
    place in a menu because it answers "what is this, and is it safe to leave running?", which
    is the question a menu is the obvious place to ask. Settings keeps its own About link,
    since someone already reading settings is looking for it there.
27. [x] pencil icon should be on same line as the rest of the text for the entry (left
    hand end). Done, at the left-hand end of the row's first line. Getting there took three
    attempts, all of which looked fine in the DOM and were wrong in a browser:

    As a grid cell of its own it shared a column with nothing. As the last item of a flex
    column it could only ever land on a row of its own — measured at 23px below the text it
    was supposed to share a line with, and below the project name whenever an entry had no
    note. Pinned to the *right* edge fixed the row but put it at the far end of the row
    rather than beside the text, and it is on the left here because that is where it was
    asked for.

    Out of flow, so it cannot be pushed onto its own row, but still in the document, so it
    keeps its place in the tab order. Moving it to the left also overflowed the row at 320px
    for a while, which is the 0002 R1 constraint and is checked in a browser for that reason.

28. [x] entry type (daily/weekly/all) should be remembered. Done. A control that resets on
    every reload is one the user sets again every time. Stored in IndexedDB `meta`, since
    0011 R5 allows only the theme key in `localStorage`; the control shows "all" for a frame
    before the stored value lands, which is the same trade-off the currency preference made.
29. [x] hamburger menu should still have words beside each icon. Done, and the words are one
    character case lower than the long forms: "download" and "import" beside the icons,
    rather than "Download backup" and "Restore from file". The long forms stay on the
    settings panel where there is room to finish the sentence; here they crowd three buttons
    into a strip that is only ever three buttons wide. No `aria-label` is added on top —
    a control whose visible text and accessible name differ is announced twice.
30. [x] duration on entry edit page should include seconds. Done, and this fixed a data-loss
    path rather than a cosmetic one. `toDurationInputValue` rounded to whole minutes, so a
    25-second entry — which is what stopping a timer after a glance produces — came back as
    `00:00` on the edit page, and saving that without noticing wrote an entry of no length
    at all. The field now carries seconds when there are any, and the parser accepts
    `HH:mm:ss`, because an entry edited and saved without a change must keep its length.
    Whole-minute entries keep the shorter `HH:mm` form.
31. [x] default currency setting should be honoured when creating a new client. Done, and it
    had been hardcoded to GBP. Setting the default currency and then adding a client that
    ignores it is worse than having no default at all — the user has told the app what they
    bill in, and every subsequent client has to be corrected by hand. `null` stays distinct
    from the fallback, so the last link in the chain applies until they say otherwise, and
    an existing client's currency is never overwritten: doing that would silently restate
    what they already charge.
32. [x] new client icon should be on same line as "TIMER" (in timer card) this will make the
    card shorter. Done. It sat alone in a row of its own above the list, costing a row of
    height on the card the user looks at most often, for a button that is about the list
    below it. The editing state moved up to `TimerPanel` with it, so the button can live in
    the panel header.
33. [x] edit entry sheet - default focus should be on "save changes". Done, and only when
    editing. A *new* entry deliberately does not focus Save: its times are empty, so focusing
    a control that cannot yet succeed either fails validation the moment the sheet opens or
    saves an entry with nothing in it. Focusing nothing is the better of those.
34. [x] daily/weekly/all selector should not move based on filter for client (entries card).
    Done. With the heading, the filter note and the controls sharing one flex row, showing
    the note pushed the period selector sideways — so the control the user was about to press
    moved because of something they did to a *different* control on a different card. The
    header is now three grid columns with each child pinned, and the note is clipped rather
    than wrapped, so a long client name cannot move it either. Measured in a browser, because
    auto-placement has a subtlety that looks correct in review: with only two children the
    controls landed in column 2 and jumped to column 3 the moment the note appeared.
35. [x] edit and discard button sizes should match as well as start/stop, so that buttons
   don't move when start is clicked — **done.** `Start` is wider than `Stop` and `Edit`
   narrower than `Discard`, so pressing Start shrank the first button and grew the second:
   the control under the pointer changing shape as it is pressed. Each slot is pinned to the
   widest word that ever occupies it, and the browser suite now asserts both width *and*
   left position across the transition, beside the existing row-height check.
36. [x] do not allow delete of only remaining project against a client — **closed by item 41.**
   Answered at the root rather than per-case: clients and projects are not deletable at all,
   so there is no path to deleting a client's last project.
37. [x] archived clients should not appear in the list for starting a timer — **done in item
   41.** `useTaxonomy` deliberately loads archived records and leaves filtering to each view,
   and `TimerPanel` was the one view that never filtered. The wrinkle held up: a client
   archived *while* one of its timers runs stays visible, or the row vanishes and the timer
   reappears in the orphan row claiming it has no client. Both halves have tests.
38. [x] add info on creating github issues for feedback to the about page — **done.** A
   "Found a problem?" panel with a prefilled new-issue link, plus a request *not* to attach a
   backup file: a backup is the user's work, and a public issue is the last place it belongs.
   The repository URL is a constant in `src/app/repository.ts` rather than a literal in the
   view, so a fork has one place to change it.
39. [x] add a privacy policy to the about page — **done**, and it closed an unmet MUST.
   `0011 AR2` requires the absence of encryption to be documented *in the settings screen*,
   and nothing in the app said so anywhere. The policy states what the app cannot do (no
   analytics, telemetry, cookies or third-party assets; no accounts, no server), where things
   are stored, and what a compromised Dropbox account would expose — plus how to remove
   everything. The same disclosure now also sits on the sync panel, because that is where the
   decision to sync is made and a policy behind a link is a policy nobody opens.

   Five tests assert the *claims*, since the failure mode of a privacy policy is being quietly
   untrue: a change to storage can invalidate a sentence without touching the page. The
   behaviour behind "no analytics" is not asserted here and cannot be — it needs a browser
   watching every request, which is the e2e suite's job (0011 P6).
40. [x] the title says "dev" on a non-production origin — **done.** Marked as a small badge
   beside the name rather than as part of it: "Time Tracker DEV" reads like a fork, where a
   quiet stamp says the same app on another origin. It reads `environmentForHost`, the same
   function that picks the Dropbox app, so the badge and the sync target cannot disagree —
   the failure that matters, since a dev build writing to production Dropbox is the dangerous
   one and a badge claiming otherwise is worse than no badge.
41. [x] **Clients and projects are not deletable; archiving replaces it.** **Done.** Spec
   (0005 X1–X7), storage, settings, timer card, entry form and tests. This supersedes item
   36 and was a product change rather than a bug fix.

   *Why:* retiring a project is usually not a rare destructive act — it is a project that has
   finished. Offering both "archive" and "delete" meant the safe button got used less than it
   should have, because the destructive one looked like the official answer. The old rules
   (soft delete, impact counts, second confirmation, undo) were defensible; the premise was
   not.

   *Scope:*
   - Remove `deleteProject`, `deleteClient`, `undoDeleteProject`, `undoDeleteClient`,
     `projectDeleteImpact`, `clientDeleteImpact` and their receipt types from
     `storage/taxonomyRepo.ts`.
   - Drop the Delete button from `ClientRow` and `ProjectRow`; Archive/Restore already exists.
   - `useTaxonomyDeletes` becomes `useTagDeletes`, tags only — deleting a tag *moves* entries
     rather than hiding one, so it keeps its count, confirmation and undo.
   - Filter archived records out of every choice (0005 X4): the timer list, the project
     picker, and the client filter. The client filter *is* the timer card's client name
     button, so there is no separate control to fix.
   - Keep an archived record visible when it is the entry's **own** current value, else the
     `<select>` holds a value with no option and saving silently re-files the work.

   *Tests to remove or rewrite:* ~7 describe blocks in `storage/taxonomyRepo.test.ts`
   (project/client delete, tombstones, names freed by deletion, undo, impact counts),
   35 references in `TaxonomySettings.test.tsx`, plus `EntryForm.test.tsx` and
   `App.test.tsx`. Replacement coverage is the point and is not mechanical: archiving instead
   of deleting, archived records absent from each picker, and the chosen-archived-record
   exemption.

   *Two things worth knowing that came out of it:*

   - **A tombstone can still arrive from 0.1.0**, which shipped with delete enabled. So the
     guards against resurrecting a soft-deleted project stay, and their tests now write the
     tombstone straight into the table — otherwise they would only exercise a state this
     code can no longer produce, which is exactly the case needing cover.
   - **Archiving a client does not free its name**, unlike a project. Deliberate and spec'd:
     client names are globally unique regardless of archived state, because a report
     attributes by name. The consequence is that archiving is a one-way door for a *client's
     name* even though the record itself is restorable. Asserted side by side so the
     asymmetry is deliberate rather than accidental.
42. [x] remove the "running" tag from client with running timer - just keep the timers
   ticking — **done.** The badge said "running" beside a figure already counting up, so the
   word was read first and the number read as decoration. Only the visible word went: the
   row keeps `aria-current` and its active class, so *which* client is still conveyed to a
   screen reader and still drives the highlight.
43. [ ] About page needs work.
44. [ ] settings page needs work.
45. [ ] what shows by default needs some work.
46. [x] **all settings should remain across the page in dropbox storage** — **done.**
   The three settings that describe how you work — default currency, visible currencies,
   entries period — now live in their own `settings` table and travel in the sync payload
   and in backups.

   The obstacle was not the envelope, it was that `meta` held two unrelated things: the
   user's preferences and this device's `lastRev`/`lastSyncAt`. Syncing settings therefore
   meant deciding which rows of one table to send, and getting it wrong would have shipped a
   revision number to Dropbox. Splitting the tables makes the exclusion structural.

   Each setting is written as a `Mergeable`, so it merges through the existing union-by-id,
   last-write-wins path with no rule of its own to be wrong.

   Two settings are deliberately still local. The theme, because 0002 TH4 needs it before
   first paint and only `localStorage` can be read synchronously. The Dropbox app key,
   because it is chosen by host — syncing it would let a local build inherit the deployed
   app's identity, which is the one mistake in this file that could damage real data.

   Schema v4 carries the three existing `meta` rows across. They are copied rather than
   moved, so downgrading loses nothing.
47. [x] **when should dropbox connect auto-run?** — **answered, and the premise changed.**
   The item asks to record the last connection attempt and retry after *x* minutes. That
   turns out to retry the wrong thing: the provider was receiving a refresh token from
   Dropbox and discarding it, so there was nothing to retry *with*. Every timed retry would
   hit the same wall, fail, and — worse — re-run the discard path, silently deleting a
   working credential on a schedule.

   So the answer is not a timer, it is three pieces:

   - **Store the refresh token.** Already present in the token response, read and thrown
     away, on the stated reasoning that Dropbox only issues one to confidential clients.
     That was factually wrong. Stored beside the access token in `secrets`, so it stays out
     of backups by table structure.
   - **Refresh on 401/403, once.** Both `pull` and `push`, through one shared wrapper. Bounded
     to a single retry, because a dead refresh token answers `invalid_grant` and an unbounded
     retry is a loop that looks like syncing. One exchange per session for a dead token, so
     an open tab does not spend a token request per cycle. Concurrent failures share the
     exchange rather than racing each other's credential write.
   - **Retry a transiently failed cycle, backed off.** `network` and `rate-limited` only,
     three attempts at 5s/30s/120s, budget reset on success. Specified as C6.1, because the
     distinction from the C6 polling ban is the whole reason this is allowed: the timer only
     exists after a failure, so a healthy tab schedules nothing.

   `auth` and `scope-missing` are excluded from retrying: waiting fixes neither, and
   re-arming on them would destroy a dead credential once per cycle.

   Three defects found while doing it, all by tests written for the new behaviour:
   `stop()` did not clear the armed retry, so a torn-down scheduler kept syncing;
   `syncNow()` did not check `stopped` at all, so a manual sync after teardown started a
   cycle nobody held; and `hasUsableToken()` reported "not connected" purely because the
   *access* token had expired, which is consulted *before* any refresh can run — so the
   first three commits changed nothing a user would ever see. Now specified as C6.1–C6.3.

   **On "how long should the connection last": there is no time limit.** Nothing here expires
   a credential on a schedule. It lasts until Dropbox refuses the refresh token, or the user
   removes the app or disconnects — which is indefinite from the app's side, and a five-day
   requirement is met by an unbounded one. The thing that had to be fixed to get there was
   not the lifetime but the discarding: a 5xx or a dropped connection during a refresh was
   being treated as a rejected token, and the scheduler's answer to `auth` is to destroy the
   credential and ask the user to sign in again. So one network flicker cost someone their
   connection. Only an explicit refusal now retires it (C6.3).
48. [x] on timer stop, do not go to edit screen automatically — **done.** Stopping writes
   the entry and stays put. The offer to classify it is a line on the timer panel with a link
   to the form, which is what US2's routing actually bought, and it expires when the next
   timer starts. `0001 US2` amended rather than ignored: the intent — classify while fresh —
   is kept, only the screen-grab is dropped.

   One placement detail worth keeping: the notice renders *before* the client list's
   empty-or-not branch, not inside the list. Inside it, the person most likely to be stopping
   their very first timer was the one person who never saw the offer, because they had no
   clients yet.
49. [x] client lines in the TIMER card should remain in static location — **done.** Every
   client line moved down 47px when Stop was pressed: the "saved as uncategorised" notice
   rendered *above* the list, so the second client you were aiming at slid out from under the
   button. Height was already checked (item 19); position was not, and height is not position.
   The notice now sits below the list — a notice about something you just did belongs under
   the thing you just did, and nothing above can shift. The browser suite measures every
   row's `top` across the transition.
50. [x] on settings page move tags into it's own card — **done.** They were the third
   section of a panel headed "Settings", below two lists of records they have nothing to do
   with. A tag is not a client or a project, is not scoped to one, and its delete flow is the
   only one left with an undo bar — all of which got lost in a shared card. Its confirmation
   and undo bar moved with it, so they no longer appear under a heading about clients and
   projects.

   The remaining panel is headed **"Clients and projects"** rather than "Settings", which
   named nothing at all inside the settings page — every other panel there is named for its
   contents.
51. [x] settings page: projects should be grouped with their clients, client name, when clicked on should show the list of clients. default to collapsed.
52. [x] the "Sync Card" on settings page does not need to say "Non Production" in dev version.
53. [x] when scrolling on a page, keep the header static (not scrolling)
54. [x] settings page: compress clients and projects into one section — each client is a row that both carries its own actions and reveals the projects under it.
55. [x] settings page: a "new project" button on each client, so the project is created in the context of that client.
56. [x] settings page: no "new project" button in the section header; each client's button sits under the last project in that client.
57. [x] settings page: a client's projects are hidden while the client is archived, unless "show archived" is selected.
58. [x] settings page: no "new project" button under an archived client.
59. [x] settings page: no "No client" group when there is no internal work.
60. [x] settings page: an archived client's name has a strikethrough; the word "archived" does not.
61. [x] when selecting a customer on the main page, it should add the list of projects under that customer with buttons to start timer on that project.
62. [x] Dropbox sync button is opening the settings page if I click on it. that should not be the case.
63. [x] timer card - edit buttons go away, start buttons become right aligned (leave space for the discard and only show it while a timer is running). swap "start" "Stop" words for play & pause icons. the "discard" should be swapped for a red X icon.
64. [x] timer card is incorrectly reporting that timers are stored uncategories on stop. it should be impossible to store them uncategorised now.
65. [x] replace text on dropbox info with icons (on main page). The header indicator is one
    cloud carrying the state — a tick, a bang, a clock or chasing arrows — tinted by the
    existing `--sync-*` tokens, with the words moved to the tooltip and the accessible name.
    The privacy policy now also says the page is served by GitHub Pages and points at GitHub's
    own privacy statement for what the *host* processes.
66. [x] a project row runs its own timer (items 61 and 63) — play/stop, discard and a count-up
    on the project's own line, not only on the client's.
67. [x] tooltips on the "new client", Dropbox and discard buttons, each saying what the press
    will do rather than repeating the label.
68. [x] **cover the path from the released 0.1.0 to this build** — three suites, because the
    three things it touches were each individually tested and jointly untested.

    - `src/storage/db.migration.test.ts` — a database seeded at **v3** through a throwaway
      `Dexie` subclass declaring the old stores verbatim, then opened against the current
      schema. This is the *only* thing that runs `db.ts`'s `.upgrade()`: every other test
      opens a fresh database at the current version, so the one callback in this codebase
      that moves a row was dead code as far as the suite was concerned. It asserts the three
      preferences survive, that `lastRev`/`lastSyncAt` are **not** carried across, that
      tombstones survive, that it is safe to run twice, and that a device which never set
      the preferences gets none invented.
    - `src/export/legacyFile.test.ts` — a hand-written envelope in the exact shape 0.1.0
      wrote (schema 3, **no `settings` key**). Asserts that absent is dropped rather than
      defaulted to `[]`, and that restoring such a file leaves this device's own preferences
      alone. A file saying nothing about your settings is not a statement that you have none.
    - `src/sync/engine.legacy.test.ts` — that file through the whole engine, asserting the
      cycle succeeds, every record arrives, a project deleted on 0.1.0 stays deleted, this
      device's settings are untouched, both devices' work merges, and what is published is
      still readable by an 0.1.0 build.

    Each was checked against a deliberately broken version: a typo in the carried key list,
    `.default([])` instead of `.optional()`, refusing an older schema, and filtering
    tombstones out of the merge. All four failed the tests that were supposed to catch them.

    **Why this was worth doing.** 0.1.0 shipped at `SCHEMA_VERSION = 3`, so this is not a
    hypothetical: it is the first load on every existing device, and the failure mode is
    silent either way. A broken upgrade resets a billing currency and an entry period with
    the app still looking healthy; a tombstone dropped by the merge resurrects a project the
    user deleted three versions ago and republishes it.

# Where the branches are

- `phase-2a` — basic end-to-end: timer, entries, storage, list. Merged as PR #3.
- `phase-2b` — Dropbox sync, merge, backup. Complete; **still not pushed** as its own
  branch. Its work reached `main` via `phase-4`.
- `phase-3` — test suite. Complete; folded into `phase-4`'s history, since each phase
  branches from the previous phase's head.
- `phase-4` — taxonomy. Merged as PR #4 and **released as 0.1.0**. Deployed and verified
  live: `/package.json` 404s, so Pages is on Actions rather than branch source (0009 MP1).
- `phase-5` — reports and charts. **Current branch.** Local only, see item 1 below.

## Outstanding on `phase-2b` and `phase-3`

1. [ ] **Push the branches.** `phase-2b` and `phase-5` are local only. `phase-4` is pushed.
   Write access works over SSH, so this is no longer blocked on a token — it just needs
   doing, and 30-odd commits of `phase-4` did sit on one machine until the release.
2. [ ] **Sync has never run against real Dropbox.** The scopes are now granted — re-verified
   5 October 2026 against the live authorize endpoint, where both apps now reach consent for
   both content scopes and previously answered `scope_not_granted`. Recorded in
   `docs/dropbox-app-setup.md`.
   *Still outstanding, and none of it is a code change:*
   - [ ] a first sync against **production**, confirming the panel reports a time rather than
         "waiting"
   - [ ] `docs/UAT.md` section 15 — two devices, both offline, converge with nothing lost
   - [ ] **Settings → Access token expiration** set to *Short-lived* on both apps. The app now
         sends `token_access_type=offline`, so it does not depend on this — but the two are
         consistent and this is what the app expects.

   An earlier version of this file said the non-production app was "configured and
   working". That was wrong, and contradicted the setup doc beside it. Corrected here
   rather than left to be found during a release.

   **This gates the 0.1.0 merge.** The app is fully usable without sync (0007 AU8), so
   this is not a data-loss risk — but shipping a Connect button that leads to a failed
   consent flow is worse than not having one, so the merge waits on: both scopes granted,
   a first sync completed against production, and the two-device test in UAT section 15.

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
3. [x] **The app default currency was device-local** — **fixed by item 46.** It lived in
   IndexedDB `meta` alongside this device's own sync bookkeeping, and `meta` is excluded from
   both sync and backup, so a second device did not inherit it. Settings now have their own
   table, so syncing them needed no new merge rule: each setting is one row shaped exactly
   like every other mergeable record, and union-by-id with last-write-wins is already the
   right rule for a single value under a stable key.

   The theme stays device-local on purpose, and cannot be otherwise: 0002 TH4 needs it
   readable before first paint, which IndexedDB cannot do.
4. [ ] **The taxonomy undo window closes when you leave the settings view.** The receipt is
   component state, so navigating away discards it and the deletion stands. The entry undo
   bar in `App.tsx` survives navigation because it lives at the app level; moving the
   taxonomy one up would need the receipt held outside `TaxonomySettings`.
   **Now tag deletion only** — clients and projects are not deletable (item 41), so there is
   nothing of theirs left to undo. Which means the cost of fixing this dropped a long way:
   one tag's entries lose it, and it is restorable by retyping.
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
8. [x] **State seeded in `useState` from something that arrives later stays stale.** A new
   client's currency was seeded once from the app default, which had not been read yet, so
   it kept the fallback and item 31 did nothing. It is now derived —
   `picked ?? appDefault ?? FALLBACK` — so a late read has something to update. Worth
   remembering whenever an initial value comes from storage.
9. [x] **A clickable control that depends on an async read must not be clickable yet.**
   Start was live while the client's default project was still being read, so a quick click
   started a timer with no project and the time was recorded *uncategorised* for a client
   that had one — silently, and with no way to tell afterwards. Found by a test that failed
   once in six runs, which is worth remembering: a rare failure is usually a real ordering
   bug rather than a flaky test, and re-running until it passes hides it.

   **It came back, in the same shape, and it was this note being right.** A test that added a
   project and pressed Start expecting the new default failed about one run in four. The cause
   was here: the panel held the default-project map and re-read it keyed on the project ids,
   so between the project landing and the read finishing, every Start on the card was filing
   against the project that *used* to be the default. The map now carries the id list it was
   read from, and Start is disabled while the two disagree.

   The test had two races stacked, and fixing only the first is what made it look fixed for a
   while. It waited on a condition that was already true, so it guarded nothing; and waiting on
   the button being *enabled* was still not enough, because a project could land between that
   check and the click — and a click on a disabled button is silently dropped, so the failure
   showed up as a length rather than a value. It now retries the click until a Start is
   recorded against something other than the old default. That is the only form of the
   assertion that cannot pass by accident: a panel still holding the stale map records the old
   id however many times it is pressed.
10. [ ] **A Dexie transaction fails if it touches a store it did not declare**, and says
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
