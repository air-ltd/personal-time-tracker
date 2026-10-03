# personal-time-tracker

A personal time tracker that runs entirely in the browser and is published as a
static GitHub Pages site. No server, no accounts; data lives in your browser and
optionally syncs to your own Dropbox.

## Status

In development. Through Phase 4 (taxonomy) — see
[`SPECS/0014-development-plan.md`](SPECS/0014-development-plan.md) for the phase
sequence and each phase's gate.

| Phase | What it covers | State |
| --- | --- | --- |
| 1 | Static shell, hash routing, theme, Pages deploy | Done |
| 2A | Timer, entries, day-grouped list, soft delete | Done |
| 2B | Dropbox sync, cross-device merge, backup/restore | Done |
| 3 | Test suite, property tests, silent-failure gate | Done |
| 4 | Projects, clients, tags | Data layer done; UI not started |
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
npm run verify     # typecheck, format, lint, tests, build
```

Two commands are deliberately **not** part of `npm run verify`, because both are slow
or need something the ordinary loop does not have:

```bash
npx playwright install chromium   # once, before the browser suite
npm run test:e2e                  # loads the built site in a real browser
npm run check:silent              # introduces each silent failure, requires a test to fail
npm run test:coverage             # coverage for domain, storage, export and sync
```

`check:silent` rewrites source files and runs the suite eleven times. It restores each
file afterwards, and reports `stale` for any mutation that no longer matches the code —
which is the signal to update it.

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
