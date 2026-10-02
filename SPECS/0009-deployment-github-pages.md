# 0009 — Deployment on GitHub Pages

**Status:** `Draft`
**Depends on:** 0002

## Mechanism

Deploy via a GitHub Actions workflow publishing to Pages. The requirements below
are not specific to that choice, so a legacy build-and-push script would also
satisfy them — the workflow is preferred for the reasons in CI2–CI4.

### Pages must be set to GitHub Actions

Added after this failure was hit in practice.

**MP1** — The repository's Pages **Build and deployment → Source** MUST be
**GitHub Actions**. It MUST NOT be "Deploy from a branch".

With the legacy branch source, GitHub publishes the repository root and ignores
the build output entirely. The site then serves the source `index.html`, which
references `/src/main.tsx` — a path that exists only on disk, never in a
published site. The result is a **partially working page that looks broken rather
than a clean error**, which makes it slow to diagnose.

**MP2** — In that misconfigured state the build output is not published at all,
but the repository contents are. Source files, `package.json` and this `SPECS/`
directory are all publicly fetchable. Switching to GitHub Actions publishes
`dist/` only, which is the correct exposure for a tool holding personal data.

**MP3** — `actions/configure-pages` fails with `Not Found` when the Pages site is
not already configured for Actions. That failure is the symptom, not the cause;
do not debug the workflow when it appears.

**MP4** — This is a repository setting, not a file in the repository. It cannot be
fixed in a pull request, and it does not revert when the branch is deleted. Verify
it explicitly rather than assuming a green workflow implies a correct deployment.

- **D1** — The build MUST produce a self-contained static tree: no server, no
  runtime config fetch, no external asset references (0011).
- **D2** — Pages SHOULD be served from a GitHub Actions workflow over the
  `gh-pages` branch or the Pages artifact, rather than a legacy build-and-push
  script. Branch protection then applies and CI status gates the deploy.

## Base path

The dominant deployment failure mode. A project site is served from
`https://<user>.github.io/<repo>/`, not from the domain root, so absolute asset
paths break with a blank page or a 404 on every script.

- **B1** — The build MUST read its base path from configuration, not from a
  hard-coded literal in source.
- **B2** — Vite's `base` MUST be set to `/<repo>/` for a project site, or `/` when
  deploying to a user or organisation site (`<user>.github.io`).
- **B3** — The router MUST derive its base from `import.meta.env.BASE_URL` rather
  than assuming a root. See 0002 R1 for why routing is hash-based regardless.
- **B4** — Assets MUST be referenced via the bundler, never as absolute
  `/assets/...` strings.
- **B5** — The build MUST NOT hard-code `github.io`. The same output SHOULD work
  behind any path, which also keeps local preview honest.

## Routing, again

- **P1** — Hash routing is mandatory (0002 R1). GitHub Pages has no SPA fallback,
  so `/reports` is a 404 and no amount of client-side routing recovers it.
- **P2** — A `404.html` copy of `index.html` MUST be emitted (0002 R4).
- **P3** — The app MUST load correctly from `/<repo>/` with no trailing path and
  with a deep hash such as `/#/reports?range=week`.

## SPA-ification aside

If path routing is ever genuinely required, it needs a domain with a real
rewriting host, or an external redirector. Worth recording so it is not
rediscovered later.

## Build configuration

- **C1** — Output directory MUST be consistent between the bundler config, the
  Actions workflow and Pages settings. A mismatch between `dist/` and `docs/` is
  a common and confusing failure.
- **C2** — The build MUST succeed with `NODE_ENV` unset, so it behaves the same
  locally and in CI.
- **C3** — The build MUST NOT depend on environment secrets. The app has no
  server and no keys.
- **C4** — Source maps SHOULD NOT be published. This app handles personal data
  and there is no need to expose internals.

## Caching

**CA1** — Pages serves `index.html` with a revalidation policy, so a returning
visitor can get a stale shell pointing at new asset hashes. Mitigation:

- Asset files MUST carry content hashes in their filenames and MUST be served
  immutable.
- `index.html` MUST NOT be cached long-term.
- The app MUST tolerate loading a new shell that requests an asset hash the old
  one referenced. If a stale `index.html` runs against new assets, the app MUST
  detect a version mismatch and prompt to reload rather than throwing.
- The app MUST expose the deployed version in the UI so support for "which build
  am I on" is trivial.

**CA2** — A service worker is **out of scope** for the first version. It adds
cache-invalidation complexity that can present users with a broken app, and
offline support is not required by 0001. Reconsider once the app is stable.

## Continuous integration

**CI1** — Every push and pull request MUST run: install with a lockfile, typecheck,
lint, unit tests, and a production build. **CI2** — Deploy MUST run only on the
default branch, after those checks pass. **CI3** — Dependencies MUST be installed
with `npm ci` against a committed `package-lock.json`, so CI builds what was
tested. **CI4** — Versions of third-party Actions MUST be pinned to a full commit
SHA with the version in a comment (see repo policy in `AGENTS.md`); `actions/checkout` and `actions/setup-node` will both be needed. **CI5** — CI MUST NOT require any secret to build or test.

## Versioning and rollbacks

**V1** — The deployed build MUST carry a version string, visible in the UI footer
and derived from git SHA plus a human-readable number.

**V2** — Vite asset filenames MUST include a content hash, so a rollback to a
previous Pages deployment cannot collide with newer assets still in the browser
cache.

**V3** — Because data lives in the browser and not in Pages, a deploy rollback
does NOT touch user data. A bad release can be reverted without data loss, and
schema migrations must keep this true: an older build MUST still be able to read
a database a newer build wrote, or MUST fail loudly per 0003 V4. This
cross-version compatibility is a real constraint on how migrations may be
designed and is the reason M-5 in 0007 forbids destructive migration.

**V4** — The user MUST have no dependency on any particular deployment remaining
live. Nothing server-side persists.

## Verification checklist

A deployment is not done until each of these is confirmed against the live URL:

0. **Pages source is GitHub Actions, not a branch** (MP1). Check this first: every
   other item is meaningless while it is wrong, and it fails silently.
1. Root URL loads the app.
2. A deep hash URL loads directly, not a 404.
3. The served HTML references hashed assets under `/personal-time-tracker/`, not
   `/src/`. A `/src/` reference means source is being served (MP1).
4. No repository file outside `dist/` is reachable, for example
   `/personal-time-tracker/package.json` returns 404 (MP2).
5. The favicon resolves under the repository path, not the origin root.
6. Reloading mid-timer resumes the running entry (0004 T5).
7. Closing the tab mid-timer prompts, and the timer is still running afterwards
   (0004 W1, W3).
8. Both themes render without a flash of the wrong one (0002 TH4).
9. An export downloads, and importing it into a fresh browser profile restores
   state (0007 F-EXPORT-5).
10. The app works with the network disabled after first load.
11. No request leaves for an expected external origin other than the connected
    sync provider (0011).
