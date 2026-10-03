# Code Review: personal-time-tracker

**Summary:** A local-first time tracker (React 19 + TypeScript + Vite + IndexedDB/Dexie) with Dropbox sync via PKCE OAuth, JSON backup/restore, and a hand-rolled hash router. The architecture is clean (pure domain → storage → features → sync), comments are exceptional, and the test culture (unit + property + e2e + mutation gate) is rare. I found one packaging bug, one transaction-semantics bug, one race condition, and several lower-severity issues.

---

## High severity

**1. `dexie` is a runtime dependency listed under `devDependencies`**
`package.json:39` — `src/storage/db.ts:1` imports `Dexie` at runtime. A production install (`npm ci --omit=dev`) will fail to build. Move `dexie` to `dependencies`.

**2. `writeSnapshot` does not apply as a single transaction**
`src/storage/snapshotRepo.ts:69` — The comment says "Applies as a single transaction (0007 S6)" but the loop creates a **separate** `db.transaction` per table. A crash mid-write leaves the DB partially updated (e.g., `entries` written, `projects` not). The next sync merges the partial state silently. Fix: wrap all tables in one `db.transaction('rw', db.tables, ...)`.

**3. Race condition: navigation before timer stop completes**
`src/app/App.tsx:69-71` — `onStopped` sets `window.location.hash` immediately, then `stop()` is fired without awaiting (`src/features/timer/TimerPanel.tsx:29-32`). The App's effect (`App.tsx:76-85`) calls `getEntry(editId)` — if the IndexedDB write hasn't landed, it gets `undefined`, sets `loadedEdit = {id, entry: null}`, and renders "Entry not found" permanently (the effect never re-runs because `editId` doesn't change). Fix: `await stop()` before navigating, or retry the load.

**4. `writeLocal` called before `repairReferences` — local/remote divergence**
`src/sync/engine.ts:120` vs `:142` — `writeLocal(outcome.merged)` writes the un-repaired snapshot to the DB. Then `repairReferences(outcome.merged)` mutates entry objects **in place** (acknowledged in the comment at `:139-141`), and the repaired version is pushed. The local DB keeps un-repaired references while the remote gets repaired ones. On the next sync they differ, causing a redundant push. In practice `repairReferences` is "close to a no-op" after a union merge, but when it does fire (a lost table), the two sides diverge. Fix: repair before `writeLocal`, or write the repaired snapshot locally too.

---

## Medium severity

**5. `useEntries` flashes "Loading…" on every write**
`src/features/entries/useEntries.ts:38` — `loading` is `loaded.revision !== revision`. Any write bumps the revision → `loading` becomes `true` → the effect re-reads → `loading` becomes `false`. Every edit causes a visible flash. The comment claims "a write does not trigger a cascading render" but it does trigger a loading-state change.

**6. Phantom tables in `snapshotRepo.TABLES`**
`src/storage/snapshotRepo.ts:27-28` — `contractPeriods` and `nonWorkingDays` are listed but have no Dexie table in `db.ts`. `readSnapshot` silently skips them (`if (!table) continue`). The comment says "Adding a store to `db.ts` without adding it here fails that test" — but the reverse (listing a table that doesn't exist) is silently ignored. Dead entries that imply sync coverage that doesn't exist.

**7. `scheduler.log()` hardcodes `level: 'warn'`**
`src/sync/scheduler.ts:99-101` — The method ignores the actual level and always emits `'warn'`. Misleading in logs.

**8. `EntryForm.onSubmit` uses `new Date()` instead of the `now` prop**
`src/features/entries/EntryForm.tsx:99` — The form receives `now` as a prop (for testability, per `0002 A2`) but validation and `createManualEntry` use `new Date()`. Inconsistent and untestable for time-sensitive validation.

**9. Documentation contradicts code on app key precedence**
- `docs/dropbox-app-setup.md:228-230` — "A key saved in the browser **overrides** this selection."
- `.env.example:5` — "A key entered in the Sync panel takes precedence over this."
- `src/sync/appKey.ts:99-103` — `readAppKey` **explicitly ignores** the stored browser key (by design, per the long comment at `:86-94`).

The docs describe the old behavior. This will confuse anyone following the setup guide.

**10. Stale README**
`README.md:9` — "Specification and planning complete. No code yet." The repo has a full implementation through Phase 2B+. The "Next step" section describes Phase 1 scaffolding as if it hasn't happened.

**11. E2E duration comparison is lexicographic**
`e2e/smoke.mjs:137-140` — `elapsedAfter >= elapsedBefore` compares strings like `"0:00:10" >= "0:00:09"`. This works for single-digit hours but breaks at `10:00:00` vs `9:59:59` (`"1" < "9"`). Fragile assertion.

**12. `refreshToken` stored but never used**
`src/sync/dropbox/DropboxProvider.ts:196` — Dropbox tokens expire (~4h) and the app never refreshes. The `refreshToken` field is stored but no refresh logic exists. The scheduler's `isAuthFailure` path handles expiry by discarding the token and prompting reconnect — acceptable, but the stored `refreshToken` is dead code that implies a capability the app doesn't have.

**13. `displayName` never populated**
`src/sync/dropbox/DropboxProvider.ts:200` — The token exchange doesn't fetch an account name (no `account_info.read` scope). `status()` always returns `account: null`. The `displayName` field and the `ProviderStatus.account` field are dead.

---

## Low severity

**14. `oauthCallback.ts` — `DROPBOX_REDIRECT_PATH` is misnamed**
`src/sync/oauthCallback.ts:86` — It's assigned `DROPBOX.defaultRemotePath` (the sync file path), not a redirect path. Also `currentRedirectUri()` (`:89-92`) duplicates the identical logic in `providerFactory.ts:24`.

**15. `repairReferences` mutates in place**
`src/domain/merge.ts:145-173` — Acknowledged in `engine.ts:139-141` but fragile. Any future caller that doesn't expect mutation will be bitten.

**16. `listEntries` / `listDeletedEntries` load all rows into memory**
`src/storage/entriesRepo.ts:67-83` — Full table scan + JS filter/sort. Acknowledged as acceptable at current volume, but there's no index on `deletedAt` for the active-entry query (IndexedDB can't index `null`, so this is partly forced).

**17. `deleteProject` orphans already-deleted entries**
`src/storage/taxonomyRepo.ts:282-286` — The loop orphans **all** entries with the projectId, including tombstoned ones. Bumping `updatedAt` on tombstones can cause them to win merge ties unexpectedly.

**18. `router.matchPath` — `decodeURIComponent` can throw**
`src/app/router.ts:79` — A malformed `%` in the hash throws an uncaught error, crashing the app. Wrap in try/catch.

**19. `EntryList.heading()` crashes on corrupt day keys**
`src/features/entries/EntryList.tsx:78-85` — `localDayBounds` throws on invalid keys. A corrupt `createdAt` producing `"NaN-NaN-NaN"` would crash the list render.

**20. No mobile responsive layout**
`src/styles.css:289` — `.entry-row` uses fixed `grid-template-columns: 9rem 5rem 1fr auto` with no media query. Overflows on narrow screens.

**21. Hardcoded production path**
`src/features/sync/DropboxSetup.tsx:164` and `vite.config.ts:16` — `personal-time-tracker` is baked in. A repo rename silently breaks the base path and the documented redirect URI.

**22. `engine.ts:77` — `readLastRev()` result discarded**
The comment says "read for diagnostics only" but the value is never used. A wasted IndexedDB read on every sync cycle.

**23. E2E step numbering**
`e2e/smoke.mjs:205` — Labeled "6." but follows step 9. Two steps share the number 6.

**24. `playwright` browsers not auto-installed**
`package.json:46` — `npm run test:e2e` requires a separate `npx playwright install`. Not documented in the README.

**25. `vitest/globals` types in app tsconfig**
`tsconfig.app.json:8` — Production code can accidentally use `describe`/`it`/`expect` without importing. Minor, but the app config and test config are conflated.

---

## Positive observations

- **Comment quality is outstanding** — every non-obvious decision explains *why*, with spec references. This is how code should be documented.
- **Pure domain layer** — `domain/` has no I/O, no clock reads, no framework imports. Property-tested merge invariants.
- **Defensive envelope parsing** — `looseObject` for forward-compat, total validation before any write, schema version gates.
- **Silent-failure mutation gate** (`scripts/check-silent-failures.mjs`) — verifies the suite would catch specific regressions. Rare and valuable.
- **Three-state loading** (`undefined` / `null` / value) in `App.tsx:89` — correctly distinguishes "not resolved" from "not found".
- **DST-safe day arithmetic** — `days.ts` constructs boundaries from local components, not millisecond offsets.
- **Token hygiene** — secrets in a separate IndexedDB table, excluded from snapshots structurally, never in exports, PKCE with sessionStorage verifier.

---

The four high-severity items (#1–#4) are worth fixing before the next push. #1 is a one-line `package.json` move. #2 and #4 are small structural fixes. #3 needs an `await` or a retry.
