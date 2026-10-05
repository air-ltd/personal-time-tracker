# `src/domain`

Pure business logic. No React, no IndexedDB, no `fetch`, no `window`, no `Date.now()`
— time arrives as a `now` argument, which is what makes every rule here testable by
pinning the instant rather than by waiting for it (0002 A2).

## Exports that nothing in the app calls yet

Several exports here have no production caller. **They are not dead code and should not
be deleted**, because each one implements a requirement from `SPECS/` whose UI has not
been built yet:

| Export                       | Requirement it implements |
| ---------------------------- | ------------------------- |
| `weekKey`                    | 0006 weekly reports       |
| `dayKeysInRange`             | 0006 date-range filters   |
| `localDayLengthMs`           | 0006 DST-correct day maths |
| `countRecords`               | 0006 record counts        |
| `sortEntriesForList`         | 0006 report ordering      |
| `groupByCurrency`            | 0006 / 0003 CU2 totals    |
| `projectDefaultsToBillable`  | 0005 P5 (already live in `EntryForm`, which derives it inline for a new entry) |
| `perceptualDistance`         | 0005 P3 palette choice    |

The reasoning is the same for all of them: a rule that is written down in the domain and
tested there, and *then* wired to a UI, is a rule whose correctness does not depend on the
UI being finished. The alternative — writing the arithmetic inside a component the moment
it is first needed — puts the arithmetic somewhere it cannot be tested without a browser,
and puts the requirement's definition at the mercy of whichever screen needed it first.

Each has tests. A test that exercises an unused export is not coverage of dead code; it
is the specification of behaviour the next phase will call.

`resolveCurrency` and `resolveRateMinor` **are** called in production. They are listed
here only because they were, briefly, three separate inline expressions in three
components with three different fallbacks (a hardcoded `USD` and two hardcoded `GBP`s) —
which is what this README exists to prevent happening again.

## If you are about to delete something here

Check `SPECS/` for a requirement id in the comment above it. If there is one and its
phase has not been built, keep the function. If there is no requirement id, it is
genuinely unused and `scripts/check-silent-failures.mjs` will tell you if removing it
breaks a test.
