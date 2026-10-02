# 0008 — Export formats

**Status:** `Draft`
**Depends on:** 0003, 0007

Two distinct formats with different purposes. Conflating them is a common
mistake: a JSON backup is for the app, a CSV is for spreadsheets and invoicing.

| | JSON backup | CSV report |
| --- | --- | --- |
| Consumer | The app itself, on re-import | Excel, Sheets, accounting tools |
| Contents | Everything, including deleted | One report, one shape |
| Round-trip lossless | Yes | No |
| Human readable | No | Yes |

## Relationship to sync

**S1** — The JSON backup envelope is also the sync wire format (0012 SY4). The
remote file is byte-compatible with a downloaded backup, so the user can always
fetch the raw file from the provider and import it by hand if the app is lost.

**S2** — The backup MUST NOT contain sync credentials or OAuth tokens. A file
that is convenient to email around must not also grant access to the user's
provider account (0012 AU6). Sync metadata such as `lastSyncAt` MAY be included
as ordinary settings.

**S3** — Because the remote blob is a plain JSON file, the residual risk is that
anyone with read access to the provider account can read the user's work history.
This is an accepted, documented trade-off rather than an oversight — see 0011
§Accepted risks.

## JSON backup

**J1** — The file MUST be a single UTF-8 JSON object.

**J2** — It MUST be `envelope` shaped, so future fields can be added without
breaking older importers.

```json
{
  "format": "personal-time-tracker-backup",
  "formatVersion": 1,
  "schemaVersion": 1,
  "exportedAt": "2026-10-03T12:00:00.000Z",
  "counts": {
    "entries": 412, "projects": 9, "clients": 3, "tags": 12,
    "contractPeriods": 2, "nonWorkingDays": 17
  },
  "data": {
    "projects": [ ],
    "clients": [ ],
    "tags": [ ],
    "entries": [ ],
    "contractPeriods": [ ],
    "nonWorkingDays": [ ],
    "meta": { }
  }
}
```

**J2.1** — The envelope MUST include every entity in 0003, including the capacity
entities from 0013. A backup that omits non-working days or contract data would
leave the user with entries and no record of why a week was short, which is a worse
outcome than having neither.

**J3** — `formatVersion` versions the file layout and MUST be incremented on any
breaking layout change.

**J4** — `schemaVersion` MUST match 0003's `schemaVersion`. It is what lets an
older build import a newer backup, or refuse to.

**J5** — `counts` enables a cheap integrity check and lets the importer confirm
nothing was truncated in transit.

**J6** — Entity records MUST use the exact field names and types from 0003. No
transformation at export. A backup that renames fields is a second schema to
maintain.

**J7** — Timestamps MUST be ISO 8601 UTC with milliseconds. Durations and rates
MUST be integers in milliseconds and minor units respectively.

**J8** — Soft-deleted entries MUST be included, with `deletedAt` intact.

**J9** — The export MUST NOT be pretty-printed beyond a reasonable indent. Large
backups are files people email; newlines triple the size for no benefit.

**J10** — Export MUST be a client-side `Blob` download. No server, no upload.

**J11** — Import MUST reject a file whose `format` field is not the expected
value, before attempting to parse `data`.

**J12** — Import MUST reject a `formatVersion` greater than it supports, and
SHOULD handle older versions via explicit migrations.

## CSV report

**C1** — Encoding MUST be UTF-8. The file MUST include a UTF-8 BOM, because
Excel on Windows misreads accent-free-but-non-ASCII content without one and
mangles project names.

**C2** — RFC 4180 quoting MUST be applied. Any field containing a comma,
double quote, or line break MUST be wrapped in double quotes with internal
quotes doubled. Project and client names will contain commas.

**C3** — Line endings MUST be CRLF (`\r\n`), which RFC 4180 specifies and Excel
expects.

**C4** — The header row MUST be present and MUST match the field order below.

**C5** — Time instants MUST be exported in local time **with an explicit UTC
offset**, not as bare local strings and not as UTC. A spreadsheet has no notion
of the browser's timezone, so the offset is the only thing that makes the value
unambiguous.

**C6** — Durations MUST be exported as integer minutes in a dedicated column,
alongside the human-readable form, so spreadsheets can sum numerically without
parsing text.

**C7** — Money MUST be exported as integer minor units, never a decimal with a
currency symbol, so downstream tooling does not have to strip it.

**C8** — Soft-deleted entries MUST NOT be exported (0003 D2). A backup is the
exception, and only because it is not a report.

### Columns — entries export

One row per entry. The granular, spreadsheet-friendly form.

| # | Column | Type | Notes |
| --- | --- | --- | --- |
| 1 | `id` | UUID | Stable join key |
| 2 | `start` | ISO 8601 + offset | C5 |
| 3 | `end` | ISO 8601 + offset | Empty for a running entry |
| 4 | `duration_minutes` | integer | C6 |
| 5 | `duration_display` | string | e.g. `1:30` |
| 6 | `project` | string | Empty if uncategorised |
| 7 | `project_id` | UUID | |
| 8 | `client` | string | Empty if none |
| 9 | `client_id` | UUID | |
| 10 | `tags` | string | Semicolon-separated. Commma is unavailable, being the delimiter |
| 11 | `note` | string | Free text |
| 12 | `billable` | `true` / `false` | Lowercase, unquoted |
| 13 | `rate_minor` | integer | Resolved rate, empty if none. C7 |
| 14 | `value_minor` | integer | Rounded per 0006 RD2 |
| 15 | `source` | `timer` / `manual` | |
| 16 | `currency` | string | **Resolved** currency for this entry (0003 CU5), empty if no rate resolved |

### Columns — summary export

One row per group. The rollup form, for when entries are too granular.

One row per grouping unit, plus a final `TOTAL` row so the file is self-checking.

| # | Column | Type |
| --- | --- | --- |
| 1 | `group_type` | `project` \| `client` \| `tag` |
| 2 | `group` | Display name |
| 3 | `group_id` | UUID or empty for the uncategorised bucket |
| 4 | `entry_count` | integer |
| 5 | `duration_minutes` | integer |
| 6 | `duration_display` | string |
| 7 | `billable_minutes` | integer, rounded |
| 8 | `value_minor` | integer | |
| 9 | `currency` | string | Resolved currency. Rows MUST NOT be summed across differing currencies (0003 CU2) |
| 10 | `percent_of_total` | number, 1 decimal place |

**C9** — The summary export MUST include a `TOTAL` row. A totals-bearing export
lets the user detect a bad filter or a bad import immediately.

**C10** — `percent_of_total` MUST be computed from the unrounded total and MUST
sum to 100.0 ± 0.1 across groups, or the residual MUST be shown explicitly. See
0006 RP2.

**C11** — Where a grouping spans multiple currencies, the `TOTAL` row MUST be
emitted **once per currency**, not as a single combined figure. A total that
adds GBP and JPY minor units is arithmetically valid and financially meaningless,
which is worse than no total at all.

### Columns — non-working days export

One row per `NonWorkingDay`. Separate from the entries export because these are
*not* hours worked (0013 N3), and mixing them into one file would produce a
misleading total.

| # | Column | Type | Notes |
| --- | --- | --- | --- |
| 1 | `kind` | `leave` \| `holiday` | |
| 2 | `label` | string | Free text as entered (0003 NW1) |
| 3 | `start` | ISO date | Date only. No time, no offset (0003 P1) |
| 4 | `end` | ISO date | Inclusive. Empty for a single day |
| 5 | `days` | number | Counted against contract working days only (0013 N2) |
| 6 | `part_day` | `am` \| `pm` \| empty | Empty = whole day |
| 7 | `recurrence` | `annual` \| empty | Empty = one-off |
| 8 | `observed_shift` | `previous-friday` \| `next-monday` \| empty | |
| 9 | `note` | string | |
| 10 | `billable` | `false` | Constant. Present to make the intent explicit in the file |

**C12** — The `days` column MUST be computed against the contract's work pattern,
not as a raw date difference. A fortnight spanning two weekends is not 14
non-working days, and an export showing 14 would be wrong in a way the user cannot
check without redoing the arithmetic.

**C13** — Non-working day rows MUST NOT be included in the entries export. They are
absence, not time.

**C14** — Because overlapping records are permitted and idempotent (0003 NW5), the
`days` column MUST be de-duplicated per row rather than summed across rows. A day
covered by two records counts once.

### Columns — contracted hours export

| # | Column | Type | Notes |
| --- | --- | --- | --- |
| 1 | `effective_from` | ISO date | |
| 2 | `effective_to` | ISO date | Empty if open-ended |
| 3 | `minutes_per_week` | integer | 0003 P6 |
| 4 | `pattern` | string | e.g. `Mon=480;Tue=480;Wed=480;Thu=480;Fri=300` |
| 5 | `working_days` | integer | Count of non-zero weekdays |

**C15** — `pattern` MUST serialise all seven weekdays including zeros, so the file
is unambiguous about which days are worked. Omitting zero days would make a
four-day contract look identical to a five-day one with a short Friday.

**C16** — There MUST be no leave-allowance or entitlement column. Entitlement is out
of scope by decision (0013 §Deferred), and the schema stays ready for it without
reserving a field.

## Formatting helpers

**F1** — Duration formatting MUST live in one shared function used by the UI and
both CSV writers. A CSV showing `1:30:00` while the screen shows `1h 30m` reads
as two different numbers.

**F2** — The function MUST handle durations over 24 hours (`26:00`, not
`1d 2h`) in report contexts, where hours accumulate.

**F3** — The function MUST NOT show `0:00` for a non-zero sub-minute duration
(0006 RD1).
