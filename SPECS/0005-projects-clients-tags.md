# 0005 — Projects, clients and tags

**Status:** `Draft`
**Depends on:** 0003

## Relationship model

Projects and clients are orthogonal, connected by an optional FK.

- **R1** — A project MAY belong to a client. Internal or non-client work has a
  project with `clientId === null`.
- **R2** — A client MAY have many projects.
- **R3** — Reporting MUST support both groupings independently: "by project" and
  "by client". "By client" MUST roll up all projects belonging to that client,
  and MUST also include a bucket for client-less work so totals reconcile.
- **R4** — Clients are not hierarchical. No nesting.

Tags are orthogonal to both and apply at the entry level only. This is
deliberate: tagging a project would force every future entry to inherit a tag
that may no longer be accurate, whereas tagging entries lets one project be
"research", "review" and "bugfix" on different days.

## Projects

**P1** — CRUD via a dedicated settings view. Creating a project MUST be reachable
in at most two interactions from anywhere in the app, because a missing project
blocks entry capture and the user should not abandon the timer to fix it.

**P2** — Name MUST be unique among the non-archived projects **of the same
client**, compared case-insensitively after trimming. Projects with no client
form a single scope of their own, so two internal projects still cannot share
a name.

*Revised.* This was originally "unique among non-archived projects", globally.
Two consequences made that wrong rather than merely strict. Every client
could not then have a project called "General", which is the obvious name for
a client's catch-all and the one a per-client timer list most needs to show
consistently. And a global rule made the constraint invisible in the UI: the
two projects are never shown together, because they sit under different client
headings, so the collision it prevented was one the user could not encounter.

Client and tag names remain globally unique — neither has a client to be
scoped to.

**P3** — Colour MUST be chosen from a fixed accessible palette rather than a free
colour picker, so charts stay readable and colour-blind-safe by construction.
The user MAY override, but the picker defaults to the palette.

**P4** — A project with a colour MUST be distinguishable from every other
project colour. Adjacent palette entries MUST meet WCAG contrast requirements
against both the light and dark chart background. See 0010.

**P5** — `defaultRateMinor`, when set, implies `billable === true` on new
entries for that project (0003 rate resolution).

**P6** — A project's currency MAY override its client's. This is the escape hatch
for the case where one client is billed in more than one currency — see 0003 CU3,
which is why per-client currency alone is not sufficient.

**P7** — Currency MUST be selectable per client from the ISO 4217 list, presented
by currency not by raw code, so "GBP — Pound Sterling" is pickable without
memorising codes.

**P8** — Changing a client's currency MUST NOT rewrite existing entries. It
changes what future and future-computed figures resolve to, and the user MUST be
told that historical figures will display in the new currency. Retrospectively
relabelling money already billed would be worse than the inconsistency.

## Archiving

**A1** — Archiving MUST NOT delete anything. Historical entries keep their
`projectId` and continue to appear in reports with their original colour.

**A2** — Archived projects MUST be hidden from default pickers but MUST remain
reachable via an explicit "show archived" control, otherwise historical entries
become uneditable.

**A3** — Archived projects MUST NOT appear in report filters by default.

**A4** — Archiving a client MUST NOT cascade to its projects. A client can be
archived while its active projects continue, and reports continue to attribute
those entries to the archived client.

**A5** — There MUST be a restore action for both.

## Deleting projects and clients

Deleting is destructive and rare. See 0003 F3.

**X1** — Deleting a project MUST set `projectId = null` on its entries rather than
removing them. The user MUST be shown a count of affected entries and the number
of billable hours involved before confirming.

**X2** — The confirmation MUST state plainly that entries are kept but lose their
project.

**X3** — Deleting a project with billable entries SHOULD require a second,
stronger confirmation.

**X4** — Deleting a client MUST NOT affect its projects. It sets `clientId` to
`null` on those projects, which moves their entries into the client-less bucket.
The user MUST be warned with the affected count.

**X5** — These actions MUST be undoable, since the underlying data survives. The
undo window from 0003 D3 applies.

**X6** — These operations MUST NOT be reachable from an entry form. Destructive
taxonomy operations belong in settings, away from a mis-click on a save button.

## Tags

**T1** — Tags are created inline. Typing a new name in the entry form MUST create
the tag, because inventing a tag taxonomy in advance is not how tagging works in
practice.

**T2** — Names MUST be unique case-insensitively. Entering `Research` when
`research` exists MUST select the existing tag, not create a duplicate.

**T3** — Deleting a tag MUST remove it from entries (0003 F2). It MUST NOT delete
entries. No rate or billable state is affected.

**T4** — The app SHOULD offer merge: rename tag A to B, folding A's entries into
B and deleting A. Without it, tag cleanup becomes manual per-entry work.

**T5** — Tags have no archive state. They are cheap to create and carry no
history of their own, so archiving would add a concept for no benefit.

## Uncategorised

- **U1** — `projectId === null` MUST be a legitimate, visible state with its own
  report bucket, labelled clearly rather than as "Unknown".
- **U2** — If E1 in 0003 makes projects mandatory by default, the uncategorised
  bucket exists mainly for imported data and for entries orphaned by project
  deletion (0003 F1). The UI MUST make that clear rather than presenting it as a
  normal choice.

## Naming collision across types

- **N1** — A project and a client MAY share a name. They are distinct types and
  appear in distinct contexts.
- **N2** — The UI MUST disambiguate visually wherever both are shown together, by
  grouping or labelling, never by colour alone.
