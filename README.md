# personal-time-tracker

A personal time tracker that runs entirely in the browser and is published as a
static GitHub Pages site. No server, no accounts; data lives in your browser and
optionally syncs to your own Dropbox.

## Status

**Released as 0.2.0** (13 October 2026), covering Phases 1 to 4 plus a rebuild of the
settings page and the timer card. Later phases — reports, capacity, invoicing — are not
in this version; see [`SPECS/0014-development-plan.md`](SPECS/0014-development-plan.md)
for the phase sequence and each phase's gate.

What changed in 0.2.0: clients and their projects are one list, a project is added from
the list it joins, the timer card has one control per client, and the Dropbox state is
carried by a mark rather than a word.

- What has changed: [`CHANGELOG.md`](CHANGELOG.md), also readable in the app under
  **About**.
- Before you run it: [`docs/UAT.md`](docs/UAT.md) is a walkthrough of what the app
  does, and what to check.
- Cutting a release: [`docs/RELEASING.md`](docs/RELEASING.md).
- Outstanding work: [`SPECS/todo.md`](SPECS/todo.md).
- Accepted limitations: [`SPECS/README.md`](SPECS/README.md#known-limitations).

| Phase | What it covers | State |
| --- | --- | --- |
| 1 | Static shell, hash routing, theme, Pages deploy | Done |
| 2A | Timer, entries, day-grouped list, soft delete | Done |
| 2B | Dropbox sync, cross-device merge, backup/restore | Done |
| 3 | Test suite, property tests, silent-failure gate | Done |
| 4 | Projects, clients, tags | Done |
| 5+ | Reports, capacity, invoicing | Not started |

## Documentation

- [`SPECS/`](SPECS/README.md) — 14 specifications covering the product, data model,
  features, cross-device sync, privacy and testing
- [`SPECS/todo.md`](SPECS/todo.md) — outstanding work, and what is done
- [`docs/dropbox-app-setup.md`](docs/dropbox-app-setup.md) — manual Dropbox app
  registration, needed before sync works

## Development

```bash
npm install
npm run dev        # http://localhost:5173/personal-time-tracker/
npm run verify     # typecheck, format, lint, two repository gates, tests, build
```

Two commands are deliberately **not** part of `npm run verify`, because both are slow
or need something the ordinary loop does not have:

```bash
npx playwright install chromium   # once, before the browser suite
npm run test:e2e                  # loads the built site in a real browser
npm run check:silent              # introduces each silent failure, requires a test to fail
npm run test:coverage             # coverage for domain, storage, export and sync
```

`check:silent` rewrites source files and runs the suite once per mutation. It restores
each file afterwards, and reports `stale` for any mutation that no longer matches the
code — which is the signal to update it.

The two gates that *are* in `verify` are cheap and catch things no test asserts:

- `check:secrets` — rejects a `VITE_*` variable whose name implies a secret. Vite inlines
  every `VITE_*` value into the shipped JavaScript, and a static site cannot keep one.
- `check:citations` — resolves every `NNNN XX` requirement citation in the source against
  the ids `SPECS/` actually defines. A citation that resolves to nothing is the one
  comment a reader cannot check.

## Design notes worth knowing before reading the code

- **Local-first.** IndexedDB is the source of truth and every sync step is best-effort.
  A failure must leave the app fully usable; nothing here may block on the network.
- **The merge is the highest-risk code in the project.** It runs unattended, a wrong
  answer loses history, and a non-deterministic answer means two devices never converge
  with nothing ever reported. It is a pure function for that reason, and it is
  property-tested.
- **Deletions are tombstones, never removals.** So a deletion propagates to other
  devices, and a device that was offline for a month does not resurrect anything.
- **Colour is computed, not chosen.** The project palette is searched for contrast
  against both chart backgrounds and for perceptual separation, and a test asserts both.
  A hand-picked palette put six of twelve entries below the contrast threshold.
