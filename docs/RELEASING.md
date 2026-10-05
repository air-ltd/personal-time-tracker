# Release checklist

The order matters. Each step exists because skipping one leaves something that looks
finished and is not.

## Before you start

- [ ] `npm run verify` — typecheck, formatting, lint, the two repository gates, unit tests,
      build.
- [ ] `npm run test:e2e` — builds the site, then drives it in a real browser. **Not** part of
      `verify`, and it is the only gate that catches layout, focus and geometry defects. It
      also asserts the Content Security Policy is served and is not blocking anything the app
      needs, including the inline theme bootstrap.
- [ ] `npm run check:silent` — the mutation gate. Every planted silent failure must be
      caught **by a failing test**, not merely by a non-zero exit; the script enforces the
      distinction, and tightening it is how a mutation that only broke a file turned out to
      have been counted as coverage. A dropped `bumpRevision()` once made undo look like it
      worked, and only this gate and the browser suite could see it.
- [ ] `npm run check:secrets` — no `VITE_*` variable may name a secret. Already in `verify`,
      and listed separately here because it is the one gate whose failure would ship a
      credential to every visitor rather than merely break something.
- [ ] `npm run check:citations` — every `NNNN XX` citation in the source resolves to a
      requirement that exists. Already in `verify`; listed because a spec amendment that
      renames an id should fail the build, not wait for someone to notice a comment pointing
      at nothing.
- [ ] `npm run format:check` — separate from `verify`'s other steps only because `verify`
      already runs it; listed here so it is obvious it is not optional.

## Branch and version

- [ ] Every phase branch is pushed. Until this happens nothing you have built exists
      outside the machine it was built on.
- [ ] `package.json` version matches the release: bump the minor for a first release, or the
      patch for fixes within one.
- [ ] `CHANGELOG.md` has the release moved out of `Unreleased` and under its version and
      date. A version in `package.json` with nothing under that heading in the changelog is
      the usual way a release goes out undocumented.
- [ ] `README.md`'s status section reflects reality — not "in development" once it is
      published.

## The app itself

- [ ] The title link points at the app's own origin and base path, not the deployed host, so
      a fork links to itself. Deriving it is what this checks; a literal would not survive a
      rename.
- [ ] `public/favicon.svg` is the mark shown beside the title, and the deployed site serves
      it under the base path.
- [ ] Theme survives a reload with no flash of the wrong theme.
- [ ] The app is usable at 320px: an entry row and the delete confirmation both fit, and the
      timer and settings cards do not clip. All checked in the browser suite.
- [ ] Deleting a project keeps its entries and reports the count first, with a second
      confirmation when billable time is involved.
- [ ] Keyboard only: the header menu opens, closes on Escape, and returns focus to the button
      that opened it.
- [ ] The Content Security Policy is present in the deployed HTML, `connect-src` names only
      the provider's API origins, and nothing in the app is blocked by it. Checked in the
      browser suite against the built site, but worth one look in the deployed response —
      the whole database is the asset here, and this is the defence that keeps it on the
      device.
- [ ] Sync actually fires after recording something, without needing a tab switch or a
      reload. This was wired, debounced, tested and never called; the browser suite cannot
      see it because it has no provider, so check it by hand against the real Dropbox app.

## Dropbox

- [ ] The production app's `files.content.read` and `files.content.write` are ticked, and
      the redirect URI registered matches what the settings panel displays.
- [ ] Connect works **against production**, not only the non-production app. Until this has
      been done once, the sync path has never run in the environment it will ship in.
- [ ] A first sync completes, and the panel reports a time rather than "waiting".
- [ ] **Two-device test:** record on device A, confirm it appears on device B, then record
      the same entry on both while offline, reconnect, and confirm the merge keeps the more
      recent version and says what it did. This is the test that matters most and the one
      least likely to have been run.
- [ ] Disconnect leaves local data untouched, and reconnecting does not require a re-auth if
      the token is still valid.

## Backup

- [ ] Download produces a file with a dated name, and the panel reports what it saved.
- [ ] Restoring on a second device reproduces the entries.
- [ ] Restoring merges rather than replaces: an entry present only on the device is kept,
      and where both have the same entry the more recent one wins.
- [ ] A malformed file is refused with a reason and changes nothing. A backup that half
      imports is worse than one that does not import.

## After publishing

- [ ] The deployed site loads over HTTPS with no console errors and no failed requests.
- [ ] Reload with data present and confirm nothing is lost.
- [ ] A fresh browser with no data shows the empty state and can record an entry.

## If something is wrong

- [ ] Reverting is a matter of serving the previous commit; there is no server state to
      unwind and no migration to reverse. That is the main argument for keeping the schema
      conservative and for not letting anything irreversible into a release.
- [ ] A bad release is a revert plus a changelog entry. Do not edit a released version's
      notes — add a new version above it.
