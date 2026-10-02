# 0002 — Architecture

**Status:** `Draft`
**Depends on:** 0001

## Constraints this spec inherits

From 0001's non-goals, these are hard constraints rather than preferences:

- **C1** — Output MUST be a static file tree deployable to GitHub Pages. No
  server runtime, no serverless functions, no build-time data fetching.
- **C2** — No network calls at runtime, with one exception: calls to the sync
  provider the user explicitly connected. See 0012 SY1. There MUST be no analytics,
  no CDN and no telemetry.
- **C3** — All persistence is browser-local (see 0007), reconciled across devices
  by 0012 rather than by a server.
- **C4** — Single user. No identity, no sessions, no per-request auth. Sync
  credentials are the user's own provider tokens (0012 AU1), not app accounts.

## Proposed stack

| Layer | Choice | Rationale |
| --- | --- | --- |
| Language | TypeScript, `strict` | The data model in 0003 is the load-bearing part of this app; types are the cheapest way to keep aggregation code honest. |
| UI | React | The reporting views are heavily interactive (range pickers, chart drill-down). Declarative rendering keeps that manageable. |
| Build | Vite | Fast, produces a plain static `dist/`, native `base` option for GitHub Pages subpaths. |
| Routing | Hash-based (`#/reports`) | See "Routing" below. This is a forced choice, not a preference. |
| Storage | IndexedDB via **Dexie** | Asynchronous and structured, unlike `localStorage` (0007 S1). Dexie's versioned schema is essentially the migration registry that 0007 M1–M6 requires, already built and tested. Migrations are code that only gets exercised during an upgrade, which is exactly when you don't want bugs. |
| Charts | **Hand-rolled SVG**, Chart.js fallback | See "Charts" below. |
| Dates | Native `Date` + small helpers | At the confirmed volume a large date library earns nothing. Rendered via `Intl` (0006 DT5). |
| Validation | Zod | Export/import and sync boundaries need runtime validation that types alone cannot give. |
| Tests | Vitest + React Testing Library | Shares the Vite config; no second toolchain. |
| Format / lint | Prettier + ESLint | Standard. |

Confirmed as drafted. Deprioritised alternatives are recorded under
"Considered and rejected" below.

## Routing

**GitHub Pages serves files, it does not rewrite requests.** A deep link to
`/reports` returns a 404 because no such file exists. Hash routing sidesteps
this entirely: the server always sees `/`, and the fragment is never sent to it.

Therefore:

- **R1** — The app MUST use hash-based routing. Every internal link MUST render
  through the router, never a raw `<a href>`.
- **R2** — The app MUST render a working shell on `/` with no hash. A bare visit
  to the site root MUST NOT show a 404 or a blank page.
- **R3** — Unknown hashes MUST render a "not found" view inside the shell, not
  throw.
- **R4** — A `404.html` copy of `index.html` SHOULD be emitted into the build
  output. This is defence in depth: it costs nothing and covers the case where a
  later change introduces path-based routing.

## Charts

**CH1** — Charts MUST NOT be implemented with a charting library for the three
required views (0006 C1): a bar chart over time, a breakdown by project or
client, and a week-over-week comparison.

Rationale: these are simple shapes over small datasets. At the confirmed volume
At the confirmed volume (under ~100 entries per week, a few thousand in total)
there is no performance argument for a library, and a charting library would be
the largest dependency in the project for no benefit.

**CH2** — Charts MUST be hand-rolled SVG built on a small shared set of
primitives: an axis, a bar, a stacked bar, a share bar. All MUST accept the
project and client colours from 0005.

**CH3** — The palette MUST be the single source of truth, shared with the rest of
the app. A chart MUST NOT define its own colours (0006 C2).

**CH4** — Each primitive MUST be an accessible component in its own right, not a
`<path>` inside an `<svg>` with a `title`. 0006 C3 and 0010 AC4 require the
tabular equivalent to be keyboard-reachable, which is impossible if the chart is
opaque markup.

**CH5** — Chart.js MAY be added if a future view turns out to need interaction
this approach cannot serve — a zoomable timeline, or a dataset too dense for
DOM nodes. This is a recorded escape hatch, not a plan. Reassess if entry volume
grows well past the confirmed figure.

**CH6** — Bundle size MUST be tracked from the first build. If the app exceeds
roughly 250 KB gzipped total, that is a signal to revisit CH1 before adding
features.

## Application structure

```
src/
  app/          Shell, layout, router definition, error boundaries
  domain/       Pure logic. No React, no IndexedDB, no Date.now().
    models/     Entity and value types (mirrors 0003)
    time/       Interval math, DST handling, rounding, date bucketing
    aggregate/  Report computation (groupBy, totals, trends)
    merge.ts    Sync/import union-and-resolve (see 0012)
  storage/      IndexedDB wrapper, schema definition, migrations
  features/
    timer/      Running-entry state machine
    entries/    Entry list, create/edit/delete forms
    taxonomy/   Projects, clients, tags
    reports/    Report views and charts
    billing/    Billable totals, rate resolution, invoice line items
  sync/         Provider abstraction, Dropbox impl, engine, scheduler
  ui/           Shared presentational components
  export/       JSON backup + CSV writers
  import/       Backup reader, validation, merge strategy
```

**A1** — `domain/` MUST remain free of React and storage imports. This is what
makes the aggregation logic testable without a browser and is the single most
important structural rule in the codebase.

**A2** — `domain/` functions MUST be pure. Anything needing the current time
takes it as a parameter, so tests can pin "now" deterministically. Real-time
clock reads are confined to a thin adapter layer.

**A3** — Cross-feature imports MUST go through `domain/` public entry points,
never by reaching into another feature's internals.

**A4** — The sync merge algorithm MUST live in `domain/merge.ts` as a pure
function, not in `sync/`. It is domain logic shared by the sync engine and the
backup importer, and keeping it out of the I/O layer is what makes it testable
(0012 M1).

**A5** — `sync/` MUST NOT be imported by `domain/`. The dependency runs one way:
UI → sync → provider, and UI → domain.

## Theming

Resolved: the user can choose light, dark, or follow the system preference.

**TH1** — The app MUST support light and dark themes. The stored preference is
one of `light`, `dark`, or `system`.

**TH2** — `system` MUST be the default, and MUST track the OS setting live via
`prefers-color-scheme`. A user who has set a dark OS theme has already expressed
a preference; asking them again is friction.

**TH3** — Themes MUST be implemented with CSS custom properties on a single
`data-theme` attribute on the root element. Components MUST NOT hard-code colours
or branch on the theme in JS. This keeps 0005's palette requirement (P4, contrast
in both themes) enforceable in one place instead of across the component tree.

**TH4** — The theme MUST be applied before first paint to avoid a flash of the
wrong theme. **This conflicts with 0007 S1**, which puts persistence in
asynchronous IndexedDB: by the time IndexedDB has answered, the browser has
already painted.

Resolution: the theme is stored in IndexedDB as the source of truth, **and**
mirrored to a single `localStorage` key. A tiny inline script in `index.html`
reads that key synchronously and sets `data-theme` before the app's JavaScript
runs. IndexedDB holds the durable copy; `localStorage` holds a non-authoritative
cache used only for the bootstrap read.

The mirror is safe because a theme preference contains no personal data, is not
sensitive, and is trivially reconstructible — unlike entries, whose loss is the
thing this project is built to prevent. See 0011 R5 for the carve-out in the
no-localStorage rule.

**TH5** — `system` MUST also update without a reload when the OS setting changes
while the app is open.

**TH6** — The chart palette (CH3) and the project colour palette MUST each be
defined per theme, and both MUST satisfy WCAG 2.2 AA contrast against their own
background (0010 AC7). A colour that passes on white and fails on near-black is
not a theme palette.

## State
- **S1** — Server-state patterns do not apply; there is no server. The single
  source of truth is IndexedDB.
- **S2** — The UI MUST NOT hold a second copy of persisted data that can drift.
  Reads come from the store; writes go to the store, which then notifies
  subscribers.
- **S3** — The running timer's live duration is derived state that ticks
  locally. Only the start instant is durable (see 0004).

## Derived data

- **D1** — Reports MUST be computed at read time from entries. No report
  results are persisted, so a bug fix or a changed definition cannot leave stale
  numbers behind.
- **D2** — Aggregation runs synchronously on the main thread at the confirmed
  volume. See 0006 §Performance.

## Dependency policy

- **DEP1** — All dependencies MUST be bundled at build time. No CDN `<script>` or
  `<link>`, no runtime font fetch, no analytics. See 0011.
- **DEP2** — Dependency additions SHOULD be justified against bundle size and
  maintenance status. A time tracker does not need a large framework surface.
- **DEP3** — The total number of direct runtime dependencies SHOULD stay small.
  Every one is code the user must download before the app works offline.

- **DEP4** — Sync provider SDKs are the expected exception to DEP3, since 0012
  SY9 requires provider details to be isolated behind `sync/provider.ts`. The SDK
  MUST stay confined to its provider directory and MUST NOT leak into shared code.

## Considered and rejected

Recorded so these are not reopened without new information.

| Option | Why not |
| --- | --- |
| Svelte 5 | ~10 KB runtime and less ceremony, but a weaker charting ecosystem and fewer libraries. Bundle size is not a strong enough reason to give up the best form ecosystem, which matters because this app is mostly forms, tables and charts. |
| Vue 3 | Comparable overall, but charting is a clear step below. Little gained for the same effort. |
| Solid | Smallest runtime of the mainstream reactive options, but the smallest ecosystem. Risky for a solo project. |
| Vanilla TS + Web Components | No churn and zero dependencies, but every form, table and chart interaction is hand-written. The bulk of this app's UI. |
| Preact + `preact/compat` | React's API at a fraction of the size, but `preact/compat` has gaps and known incompatibilities with charting libraries. A clever option that bites people. |
| Recharts | Declarative and pleasant, but ~100 KB with its d3 dependencies and sluggish on dense data. Replaced by CH1–CH4. |
| ECharts | Most capable option, but ~1 MB. Overkill at this data volume. |
| `localStorage` | Synchronous, ~5 MB cap, no transactions. Rejected in 0007 S1. |
| SQLite (wa-sqlite) | Real SQL and impressive, but ~1 MB of WASM plus async initialisation, for a dataset that will fit comfortably in IndexedDB. |
| Astro as the build shell | Excellent static output, but a fully interactive SPA with a persistent timer would load nearly everything as an island anyway. An extra layer for no removed work. |
| A shared backend | Rejected; see `SPECS/README.md` § Considered and rejected. |

**FRAMEWORK-REVERSIBILITY** — This whole table is low-stakes because 0002 A1
keeps `domain/` free of React. A framework swap means rewriting views, not the
time arithmetic, aggregation or merge logic. That is the main reason to accept
the draft stack rather than agonise over it.

## Offline behaviour

**O-1** — With no network, every feature except sync MUST behave identically.
Entry capture, entry editing and all reporting MUST work.

**O-2** — Sync failures MUST be reported as status only. They MUST NOT surface as
errors blocking the user's work.

**O-3** — This is a real constraint on dependency choice: no runtime library may
require a network call to initialise.
