# 0007 — Persistence and data safety

**Status:** `Draft`
**Depends on:** 0003

**This is the most important spec in the set.** There is no server. If the
browser loses the data, it is gone. Every requirement below is about not letting
that happen by accident.

## Storage engine

**S1** — Storage MUST be IndexedDB. `localStorage` is synchronous, string-only,
and capped at roughly 5 MB; entries with notes will eventually exceed it, and a
quota error thrown during a write would lose the write.

**S2** — Object stores MUST match the entities in 0003: `projects`, `clients`,
`tags`, `entries`, `meta`.

**S3** — `meta` MUST hold `schemaVersion` (0003 V1) and user settings: week-start
day, the app-wide default currency (0003 CU4), the billable rounding increment
(0006 RD2.1, default 15 minutes), and the theme preference (0002 TH1).

**S3.1** — Sync credentials are also stored here or in a dedicated store, treated
as secrets and never included in an export (0012 AU5, AU6).

**S4** — Indexes MUST cover the actual query patterns:
- `entries` by `start`
- `entries` by `projectId`
- `entries` by `end` (to find the running entry efficiently; only one row matches)
- `entries` by `deletedAt`

**S5** — Writes MUST go through a single repository layer. Direct `IDBDatabase`
access from feature code is prohibited, so migrations and validation cannot be
bypassed.

**S6** — Multi-entry writes (e.g. delete project, update its entries) MUST be a
single transaction. A partial write would leave entries pointing at a deleted
project with no record that this happened.

## Failure modes to design against

Listed explicitly so they are treated as requirements rather than surprises.

| Mode | Consequence | Mitigation |
| --- | --- | --- |
| User clears browsing data | Total loss | F-EXPORT below, prompted regularly |
| Private / incognito window | Loss on close | Detect and warn |
| Storage quota exceeded | Write fails silently if unhandled | FB-1 |
| Browser storage evicted under pressure | Loss on low disk | FB-2 |
| Schema migration crashes mid-way | App unusable | 0003 V3, idempotent migrations |
| User opens the app in a different browser | Empty app, looks like data loss | FB-3, plus 0012 sync |
| Corrupted or hand-edited import | Garbage data | FB-4 |
| Sync provider unreachable or account lost | Data stranded remotely | F-NUDGE-3 |

## Backup

**F-EXPORT-1** — A full JSON backup MUST be exportable at any time, without a
network connection, from a reachable location in the UI.

**F-EXPORT-2** — The backup MUST contain every entity, including soft-deleted
entries, so a restore returns the app to an exact prior state.

**F-EXPORT-3** — The export format MUST be versioned and MUST include the schema
version, so a future app can migrate an old backup.

**F-EXPORT-4** — Import MUST validate before writing anything. A file that fails
validation MUST NOT partially apply.

**F-EXPORT-5** — Import MUST offer two modes:
- **Replace** — wipe and load the file.
- **Merge** — union by `id` across every entity, resolved by `updatedAt`. This is
  the same algorithm 0012 uses for device sync, and both paths MUST call the one
  implementation in `domain/merge.ts`. 0007 F-EXPORT-6 and 0012 M1–M11 govern its
  behaviour.

> **Amended — Merge only.** Replace mode is not implemented and is not planned. The
> reasoning, recorded here rather than only in `0014`, is that Replace is the more
> dangerous of the two and the one whose cost is irreversible: it discards local history
> to install a file that may be months old, and the user who reaches for it is usually
> already in trouble. Merge is also the only mode that can be safe by default, because it
> cannot lose a record the local database has and the file does not. Since a backup file
> is produced by the app that wrote it, the realistic restore is always "bring back what
> I deleted", which is precisely a union.
>
> Anyone who wants Replace can get it without trusting the app: export, then clear site
> data, then import. That path is deliberate rather than an oversight — it requires the
> user to name the consequence.
>
> Consequence for **F-EXPORT-6** and **F-EXPORT-7**: with one mode, "replaced" is
> subsumed into "merged" and the pre-import preview reports the union's size rather than
> a per-mode delta. The count of records that will be *added* is still stated before the
> import and the reasons for anything skipped are still reported after it, which is what
> those two requirements exist to prevent.

**F-EXPORT-6** — The UI MUST state before import how many records will be added,
replaced or skipped. Blind imports destroy history.

**F-EXPORT-7** — Import MUST report a summary afterwards: added, skipped, failed,
with the reasons for each failure.

## Frequency nudges

**F-NUDGE-1** — The app SHOULD remind the user to export at a low cadence, at
most once per week, and only after there is data worth protecting. An app that
nags on every visit becomes something the user dismisses without reading, which
defeats the purpose.

**F-NUDGE-2** — The app MUST NOT block usage if the user dismisses the reminder.
There is no data-loss action in this app that the user cannot choose for
themselves.

**F-NUDGE-3** — Sync does not remove the need for a local export (0012 SY5). The
remote copy is a single file in someone else's account: it can be deleted by
mistake, lost with the account, or stranded if the user stops paying. Export
nudging therefore continues on the same cadence, whether or not sync is enabled,
and the reminder SHOULD state the last local export date.

**F-NUDGE-4** — After a successful merge or a sync that brought in a large number
of records, the app SHOULD suggest an export, since the local state just became
materially more valuable than it was.

## Runtime safeguards

**FB-1** — Quota errors MUST be caught and surfaced explicitly. A failed write
MUST NOT be reported as success. The user MUST be told to export immediately.

**FB-2** — The app MUST detect a private browsing context where the API allows it
(`navigator.storage.persist()`, or by probing write behaviour) and MUST warn that
data MAY not survive the session.

**FB-3** — The app MUST NOT present an empty database as normal on first run
without distinguishing it from "data lost". A first-run state and an
empty-after-data state MUST look different. This matters because there is no
server to query for a lost copy.

**FB-4** — Import MUST reject entries violating 0003's invariants (`end` before
`start`, duplicate ids, unknown schema version) and MUST list them rather than
silently dropping them.

**FB-5** — The app SHOULD request persistent storage via `navigator.storage.persist()`
so the browser does not evict the database under disk pressure.

**FB-6** — A merge MUST NOT leave local state worse than it found it. If a merge
partially fails, the app MUST keep the pre-merge local data intact and report the
failure, rather than committing a half-merged database.

**FB-7** — Sync MUST NOT be counted as a backup in the UI's "last protected"
indicator. It is replication, not a backup, and conflating the two would lead the
user to trust it more than it deserves (0012 SY5).

## Erase

**E-ERASE-1** — A destructive "erase all data" action MUST exist, because a tool
holding personal work history with no way to clear it is a problem.

**E-ERASE-2** — It MUST require explicit typed confirmation and MUST state the
record count being destroyed.

**E-ERASE-3** — It MUST be excluded from undo. This is the one action that is not
recoverable.

**E-ERASE-4** — It MUST NOT be reachable from within two interactions of the entry
form.

## Migrations

**M-1** — Migrations MUST live in an ordered registry keyed by the version they
upgrade from.

**M-2** — Each migration MUST be idempotent, so an interrupted run is safe to
repeat.

**M-3** — The migrated version MUST be written in the same transaction as the
migration, so a crash cannot leave the version marker ahead of the data.

**M-4** — A user upgrading across several versions MUST pass through every
intermediate step. Migrations MUST NOT assume a single-version jump.

**M-5** — No migration may destroy data. If a field cannot be transformed
safely, the field MUST be preserved in a sidecar rather than dropped.

**M-6** — Migration failure MUST render a clear error state with instructions to
export the raw database, not a blank app.
