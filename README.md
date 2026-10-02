# personal-time-tracker

A personal time tracker that runs entirely in the browser and is published as a
static GitHub Pages site. No server, no accounts; data lives in your browser and
optionally syncs to your own Dropbox.

## Status

Specification and planning complete. No code yet.

- [`SPECS/`](SPECS/README.md) — 14 specifications, covering the product, data
  model, features, cross-device sync, privacy and testing
- [`SPECS/0014-development-plan.md`](SPECS/0014-development-plan.md) — phase
  sequence and gates for building it
- [`docs/dropbox-app-setup.md`](docs/dropbox-app-setup.md) — manual Dropbox app
  registration, needed before Phase 2B

## Next step

Phase 1: scaffold the project and get a static app live on GitHub Pages. The
purpose is to find out early whether Pages serves the app correctly, since a wrong
base path produces a blank page behind a fully green local build.
