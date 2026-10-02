# SPECS

Specifications for **personal-time-tracker**.

## Conventions

Requirement keywords follow [RFC 2119](https://www.ietf.org/rfc/rfc2119):
`MUST` / `MUST NOT` / `SHOULD` / `SHOULD NOT` / `MAY`.

Each spec carries a `Status`:

| Status | Meaning |
| --- | --- |
| `Draft` | Under discussion. Not yet a commitment. |
| `Accepted` | Agreed. Safe to implement against. |
| `Implemented` | Built and shipping. |
| `Superseded` | Replaced by a later spec. |

> Every spec is `Draft` until you say otherwise. Decisions made so far, the
> alternatives that were rejected, and the limitations we are knowingly
> accepting are recorded at the bottom of this file.

## Index

| # | Spec | Covers |
| --- | --- | --- |
| 0001 | [Product overview](0001-product-overview.md) | Problem, goals, non-goals, user stories |
| 0002 | [Architecture](0002-architecture.md) | Stack, module layout, routing, theming, build |
| 0003 | [Data model](0003-data-model.md) | Entities, fields, invariants, versioning |
| 0004 | [Timer and time entries](0004-timer-and-entries.md) | Timer lifecycle, manual entry, overlap rules |
| 0005 | [Projects, clients and tags](0005-projects-clients-tags.md) | Taxonomy CRUD, archive, assignment rules |
| 0006 | [Reporting and billing](0006-reporting-and-billing.md) | Aggregations, rounding, invoices, charts |
| 0007 | [Persistence and data safety](0007-persistence-and-data-safety.md) | Storage, quota, backup, import, loss modes |
| 0008 | [Export formats](0008-export-formats.md) | JSON backup schema, CSV report schema |
| 0009 | [Deployment on GitHub Pages](0009-deployment-github-pages.md) | Build output, base path, CI, rollbacks |
| 0010 | [Testing and quality](0010-testing-and-quality.md) | Test strategy, gates, accessibility |
| 0011 | [Privacy and security](0011-privacy-and-security.md) | Network policy, threat model, accepted risks |
| 0012 | [Cross-device sync](0012-sync.md) | Dropbox sync, provider abstraction, merge |
| 0013 | [Non-working days and contracted hours](0013-capacity.md) | Contract periods, expected hours, utilisation |
| 0014 | [Development plan](0014-development-plan.md) | Phase sequence, gates, silent failures |

> 0014 is a plan rather than a specification. The numbered requirements it
> implements live in 0001–0013. Phases 1, 2A and 2B are the immediate next work:
> deploy, then a working timer, then sync.

## Reading order

0001 → 0002 → 0003 are the foundation. 0004–0006 are features that depend on
0003. 0007–0009 are cross-cutting concerns that constrain everything. 0012
sits between 0007 and 0009: it reuses the backup format (0008) and the storage
layer (0007), and it constrains the CSP in 0011. 0013 extends the data model in
0003 and the reports in 0006, and its entities must be carried through 0007
(storage), 0008 (export) and 0012 (merge) — see 0012 M2. 0010 and 0011 apply
throughout.

## Resolved decisions

Recorded here so the specs stay the source of truth.

| Question | Decision | Spec |
| --- | --- | --- |
| Stack | TypeScript, React, Vite, IndexedDB via Dexie, Zod, Vitest | [0002](0002-architecture.md) |
| Charting | Hand-rolled SVG. Chart.js only as a documented escape hatch | [0002 §Charts](0002-architecture.md) |
| Sync provider | Dropbox first, behind a `SyncProvider` interface so a second can be added | [0012](0012-sync.md) |
| When sync runs | On app open, debounced after local writes, on tab focus and `pagehide`, plus a manual button. No polling | [0012 C1–C7](0012-sync.md) |
| Sync encryption | Provider-side only, no app-level passphrase | [0011 §Accepted risks](0011-privacy-and-security.md) |
| Data at rest locally | Unencrypted; relies on OS and browser profile | [0011 R1](0011-privacy-and-security.md) |
| Conflict resolution | Union by `id`, last-write-wins on `updatedAt`, deterministic tiebreak | [0012 §Merge](0012-sync.md) |
| Shared backend | Rejected. No backend this project operates, no app login, no app accounts | [Below](#considered-and-rejected) |
| Timer on tab close | Warn, then **continue running**. Leaving never stops the timer | [0004 §Closing the tab](0004-timer-and-entries.md) |
| Billable rounding | 15 minutes. Stored as a setting now, UI control deferred | [0006 RD2–RD2.2](0006-reporting-and-billing.md) |
| Currency | App-wide default, overridable per client and per project. No conversion | [0003 CU1–CU7](0003-data-model.md) |
| Invoice document | Not in this version. Totals and CSV line items only | [0006 §Invoicing](0006-reporting-and-billing.md) |
| Theme | Light, dark, or follow the system. `system` is the default | [0002 §Theming](0002-architecture.md) |
| Timezone | Store UTC, display in the browser's locale. No timezone setting | [0006 DT5–DT8](0006-reporting-and-billing.md) |
| Expected volume | Under ~100 entries/week, so a few thousand total | [0006 §Performance](0006-reporting-and-billing.md) |
| Multiple devices | Dropbox sync, not a backend. See 0012 | [0012](0012-sync.md) |
| Absence modelling | One `NonWorkingDay` entity, not an entry kind and not two entities. See 0013 CP2 | [0013](0013-capacity.md) |
| Leave allowance | Out of scope. Contracted hours only; no entitlement tracking | [0013 §Deferred](0013-capacity.md) |
| Non-working day labels | Free text. No enum, no privacy control, no warning | [0003 NW1](0003-data-model.md) |
| Overlapping non-working days | Permitted. Idempotent, since there is no quantity to double-count | [0003 NW5](0003-data-model.md) |
| Contracted hours | Effective-dated periods. Confirmed: hours do change over time | [0003](0003-data-model.md), [0013 K1](0013-capacity.md) |
| `.ics` import | Deferred, not now | [0013 §Deferred](0013-capacity.md) |
| Holiday import from official sources | Deferred. Manual entry is the supported path | [0013 §Deferred](0013-capacity.md) |
| Holiday recurrence | Fixed-date annual only. No RRULE, no nth-weekday | [0003 NW7–NW8](0003-data-model.md) |
| Absent-but-unlogged report | Wanted. See CR6 | [0013 CR6](0013-capacity.md) |

## Open questions

None outstanding. Every question raised so far has been answered.

The following are deferred by decision rather than undecided. They are recorded so
they stay visible, and each is a contained addition at the point it is picked up:

| Deferred | Note |
| --- | --- |
| Rounding increment UI | The 15-minute default is stored from day one, so exposing a control needs no migration. [0006 RD2.1](0006-reporting-and-billing.md) |
| Printable invoices | A rendering of existing line items; no data model change. [0006 I1](0006-reporting-and-billing.md) |
| `.ics` import | Needs a real parser and a date-time model that does not exist yet. [0013](0013-capacity.md) |
| Holiday import from official sources | Public data the user fetches; adds one origin to `connect-src`. [0013](0013-capacity.md), [0011 N6](0011-privacy-and-security.md) |
| Leave allowance and entitlement | Would be a new entity and new reports, not an extension. [0013](0013-capacity.md) |
| `nth weekday of month` holidays | e.g. US Thanksgiving. Visible gap, deliberately not half-built. [0003 NW8](0003-data-model.md) |
| Second sync provider | The `SyncProvider` interface exists for this. [0012 SY6–SY9](0012-sync.md) |

## Considered and rejected

Recorded so the decision survives and is not reopened without new information.

**A shared backend with its own user accounts.** Ruled out in favour of
serverless sync to the user's own Dropbox. The reasoning:

- *For it:* real-time multi-device sync, and it removes the single-file
  single-point-of-failure risk that 0011 AR3 accepts.
- *Against it:* this project would have to operate and secure a service, take on
  breach responsibility, handle user data at rest, and lose the property that the
  site is static and the data is a plain JSON file the user owns permanently —
  readable long after this project is abandoned. For a single-user tool, that is
  a poor trade.

The consequence is a specific set of accepted limitations, not an oversight:

| Limitation | Where recorded |
| --- | --- |
| No login to the app at all. Only a one-time provider consent. | [0012 AU1–AU8](0012-sync.md) |
| No real-time push; a closed device updates on next open | [0012 C6](0012-sync.md) |
| Merge correctness depends on device clocks | [0012 CS1–CS4](0012-sync.md) |
| Plaintext remote file; provider and anyone with account access can read it | [0011 AR1, AR2, AR4](0011-privacy-and-security.md) |
| One file in one account as a failure point | [0011 AR3](0011-privacy-and-security.md) |

If this project ever grows a multi-user or shared use case, the local-first core
in 0003 and the pure merge in `domain/merge.ts` are the portable parts; the
storage and sync layers are the replaceable ones. That is the reason 0002 A4
places merge in `domain/` rather than in `sync/`.

## Known limitations

Stated up front rather than discovered later. Each is a deliberate trade-off, not
an oversight.

- **No multi-user or sharing.** Explicitly out of scope (0001).
- **Sync is per-device, not continuous.** No push channel, so a device that is
  closed does not receive updates until it next opens (0012 C6).
- **Last-write-wins depends on device clocks.** A badly wrong clock can win a
  merge it should have lost (0012 CS1–CS4).
- **The remote file is plaintext.** The provider can read it, and so can anyone
  with access to the account (0011 AR1, AR2, AR4).
- **No undo across a page reload** beyond the soft-delete undo window (0003 D3).

