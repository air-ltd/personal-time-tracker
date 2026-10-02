# 0001 — Product overview

**Status:** `Draft`

## Problem

Time spent on work is easy to lose track of and hard to reconstruct after the
fact. Notes get written down inconsistently or not at all, so weekly
recollections ("I think that was about six hours on the API") are unreliable.
The result is bad estimates for future work, and no defensible answer when
someone asks where the week went.

## Shape of the solution

A personal time tracker that runs entirely in the browser and is published as a
static GitHub Pages site. There is no server, no account, and no database
outside the browser. Everything the user records lives in their own browser
profile and can be exported to a file at any time.

## Goals

| # | Goal |
| --- | --- |
| G1 | Capture time with near-zero friction: one click to start, one to stop. |
| G2 | Recover entries that were not captured live, via manual back-dating. |
| G3 | Attribute time to projects, clients and tags so it can be rolled up. |
| G4 | Report on time over arbitrary date ranges, including trends. |
| G5 | Produce billing-ready totals from billable entries. |
| G6 | Never lose the user's data, and never require the network to use it. |
| G7 | Be a static site: no backend to run, host, secure or pay for. |
| G8 | Make the data reachable from more than one of the user's own devices, without standing up a server. See 0012. |
| G9 | Stay fast and simple at personal scale — roughly 100 entries per week, thousands in total. See 0006 §Performance. |

## Non-goals

These are explicitly out of scope. Revisiting any of them means revisiting G7.

- **Team or multi-user use.** No sharing, no accounts, no permissions.
- **Server-side storage or sync.** The user operates no backend. Two browsers are
  two independent databases that reconcile through 0012's provider sync, not
  through a server this project runs.
- **Automatic activity tracking.** No window-title scraping, no idle detection,
  no OS-level hooks.
- **Invoicing as a document.** Totals and CSV line items only. A printable invoice
  can be added later without a data model change (0006 §Invoicing).
- **Timezone-spanning payroll.** Entries are stored as UTC instants and reported in
  the browser's locale. There is no timezone setting (0006 DT5–DT8).
- **Currency conversion.** No exchange rates are fetched or stored. Mixed-currency
  reports are split per currency rather than summed (0003 CU2, CU3).
- **Native or mobile apps.**

## Users

One user: the owner of the browser profile the app runs in. The app MUST NOT
assume anything about that person's employer, billing model or tax regime.

## User stories

**Capture**
- US1 — As a user, I can start a timer and have it immediately show as running,
  so I do not have to remember what I am working on.
- US2 — As a user, I can stop a running timer and land on a form to fill in the
  details, so I classify the entry while it is fresh.
- US3 — As a user, I can enter a past time range by hand, so forgotten work is
  not permanently lost.
- US4 — As a user, I can edit or delete any entry, including one just recorded.

**Organise**
- US5 — As a user, I define projects, and optionally attach each project to a
  client, so I can split my work two ways.
- US6 — As a user, I can tag entries with free-form labels, so I can slice time
  in ways projects do not capture.
- US7 — As a user, I can archive a project and keep its history, so closed work
  does not clutter pickers but reports stay correct.

**Report**
- US8 — As a user, I can see today, this week and this month at a glance.
- US9 — As a user, I can see totals for any date range, broken down by project,
  client and tag.
- US10 — As a user, I can compare this week against previous weeks to spot trends.
- US11 — As a user, I can see a calendar heatmap or chart of daily hours to
  notice gaps and overruns.

**Bill**
- US12 — As a user, I can mark entries billable and attach an hourly rate, then
  see the total value of a date range.
- US13 — As a user, I can export that billing data as CSV for my invoicing or
  accounting workflow.

**Trust**
- US14 — As a user, I can export a full JSON backup and re-import it, so a
  browser reset does not destroy my history.
- US15 — As a user, I can sign in to my own cloud drive so my entries appear on
  my laptop and my phone without me copying files by hand. See 0012.
- US16 — As a user, my entries are saved the instant I record them, whether or
  not the network is reachable.
- US17 — As a user, I can see when my data last synced and whether it is
  currently up to date.
- US18 — As a user, the app is comfortable in light or dark, and follows my
  system preference by default. See 0002 §Theming.
- US19 — As a user, I am warned if I try to close the tab mid-session, so an
  accidental close does not silently lose track of my time. See 0004.

**Capacity** (0013)
- US20 — As a user, I can flag a day as leave, and my contracted hours for that
  day drop to zero, so time off is accounted for rather than looking like time I
  forgot to log.
- US21 — As a user, I can mark public holidays, so they do not make my week look
  short.
- US22 — As a user, I can record my contracted hours and weekly pattern, so the
  app can tell me how much of my obligation I have delivered.
- US23 — As a user, I can see my utilisation and billable utilisation, which is
  the figure I actually manage against.
- US24 — As a user, I can see days that are neither leave, holiday, nor logged, so
  I can find unaccounted time.

## Success criteria

The build is a success when:

1. A user can go from opening the app to a stopped, classified entry in under
   ten seconds.
2. Total time for a date range reconciles exactly with the sum of its entries.
   Any discrepancy is a bug, not rounding.
3. Export → wipe → import returns the app to an identical state.
4. The app is fully functional with the network disabled after first load.
5. No data leaves the browser except to the one cloud provider the user explicitly
   connected. See 0011.
6. Two devices converge on a union of their entries with no loss, after both
   reconnect. See 0012.

## Glossary

| Term | Meaning |
| --- | --- |
| **Entry** | A single recorded span of time worked. The atom of time tracking. |
| **Project** | What the time was spent on. The primary grouping. |
| **Client** | Who the project was for. Optional; orthogonal to project. |
| **Tag** | Free-form label. Multiple per entry. |
| **Billable** | Entry flag meaning the time is chargeable. |
| **Running entry** | An entry that has started but not stopped. At most one at a time. |
| **Source** | How an entry came to exist: `timer` or `manual`. |
| **Report** | A computed aggregation over a date range. Never stored. |
| **Contract period** | A dated range in which contracted hours are fixed. See 0013. |
| **Expected hours** | Contracted minutes for a date range, less non-working days. |
| **Utilisation** | Worked hours as a share of expected hours. |
| **Non-working day** | A day that is not contracted, so contributes zero expected hours. Leave or holiday. See 0013. |
