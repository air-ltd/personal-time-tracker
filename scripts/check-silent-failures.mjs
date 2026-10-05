#!/usr/bin/env node
/**
 * Silent-failure gate (0014 Phase 3).
 *
 * The claim under test is not "we have tests" but "the suite would notice if these
 * specific bugs came back". A test suite that passes is consistent with correct code
 * and equally consistent with code that is wrong in a way nobody asserted. So each
 * failure below is introduced deliberately, the suite is run, and the run must FAIL.
 * Anything that still passes is a gap, and is reported as one.
 *
 * Each mutation is a single, surgical replacement. `restore` puts the file back
 * exactly, from the bytes read beforehand rather than by reversing the edit, so a
 * partially-applied mutation cannot be mistaken for a clean tree.
 *
 *   node scripts/check-silent-failures.mjs          # verify all
 *   node scripts/check-silent-failures.mjs merge    # verify the ones matching "merge"
 *
 * Only failures whose code exists can be checked. Those whose arithmetic has not been
 * written yet are listed as `pending` with the phase that introduces them, so the gap
 * is explicit rather than invisible.
 */

import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Each entry: what breaks, the exact text to replace, and the test that must notice.
 *
 * `find` is a plain string so a mutation reads as the one-token change it is. `test`
 * is the narrowest suite that should catch it — a failure in an unrelated file would
 * not show the bug is covered.
 */
const MUTATIONS = [
  {
    id: 'dst-day-length',
    failure: 'Spring-forward or autumn-back day off by an hour (0006 DT3)',
    file: 'src/domain/time/days.ts',
    // Local midnight replaced with UTC truncation — the usual way this bug arrives,
    // and the reason a day is 23 or 25 hours long.
    find: 'return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0)\n}',
    replace: 'return new Date(Math.floor(value.getTime() / 86400000) * 86400000)\n}',
    test: 'src/domain/time/days.test.ts',
  },
  {
    id: 'merge-tiebreak',
    failure: 'Merge tiebreak non-deterministic (0012 M4)',
    file: 'src/domain/merge.ts',
    find: 'return canonicalStringify(local) >= canonicalStringify(remote) ? local : remote',
    replace: 'return local',
    test: 'src/domain/merge.test.ts',
  },
  {
    id: 'tombstone-resurrected',
    failure: 'Tombstone resurrected by an older device (0012 M6)',
    file: 'src/domain/merge.ts',
    find: 'if (local.updatedAt > remote.updatedAt) return local',
    replace: 'if (remote.updatedAt > local.updatedAt) return local',
    test: 'src/domain/merge.test.ts',
  },
  {
    id: 'schema-downgrade',
    failure: 'A schema change strands a syncing device (0003 V4, 0012 M9)',
    file: 'src/domain/merge.ts',
    find: 'schemaVersion: Math.max(local.schemaVersion, remote.schemaVersion)',
    replace: 'schemaVersion: Math.min(local.schemaVersion, remote.schemaVersion)',
    test: 'src/domain/merge.test.ts',
  },
  {
    id: 'schema-not-refused',
    failure: 'Refusing an unreadable remote is what prevents silent data loss (0012 M9)',
    file: 'src/domain/merge.ts',
    find: 'if (remote.schemaVersion > supportedSchemaVersion) {',
    replace: 'if (false) {',
    test: 'src/domain/merge.test.ts',
  },
  {
    id: 'token-in-export',
    failure: 'OAuth token ends up in an export (0012 AU6)',
    file: 'src/export/envelope.ts',
    find: 'data: z.object(entityTables),',
    // Well-formed on purpose. An earlier version of this replacement was missing a
    // brace, which failed the file to parse; the gate counted the non-zero exit as a
    // catch and reported 11/11 for eleven mutations, one of which proved nothing.
    replace:
      'data: z.object({ ...entityTables, secrets: z.array(z.looseObject({})).default([]) }),',
    test: 'src/export/envelope.test.ts',
  },
  {
    id: 'overlapping-cycles',
    failure: 'Overlapping sync cycles duplicate or lose writes (0012 C3)',
    file: 'src/sync/scheduler.ts',
    find: 'if (this.running) {',
    replace: 'if (false) {',
    test: 'src/sync/scheduler.test.ts',
  },
  {
    id: 'theme-flash',
    failure: 'Theme flash on load (0002 TH4)',
    file: 'src/app/theme.ts',
    find: 'document.documentElement.dataset.theme = resolved',
    replace: 'void resolved',
    test: 'src/app/theme.test.ts',
  },
  {
    id: 'entity-table-forgotten',
    failure: 'New entity type added, forgotten in merge — that data never syncs (0012 M2)',
    file: 'src/storage/snapshotRepo.ts',
    // Drops entries from the bridge's list of tables. The merge is table-agnostic, so the only
    // symptom would be that this entity never syncs, silently.
    find: "const TABLES = ['entries', 'projects', 'clients', 'tags'] as const",
    replace: "const TABLES = ['projects', 'clients', 'tags'] as const",
    test: 'src/storage/snapshotRepo.test.ts',
  },
  {
    id: 'revision-not-bumped',
    failure: 'Data written by sync or restore never reaches the view (0012 C8)',
    file: 'src/storage/snapshotRepo.ts',
    find: '  bumpRevision()\n}\n\nconst LAST_REV_KEY',
    replace: '  void LAST_REV_KEY\n}\n\nconst LAST_REV_KEY',
    test: 'src/storage/snapshotRepo.test.ts',
  },
  {
    id: 'push-skipped',
    failure: 'Local-only changes never reach the provider (0012 C5)',
    file: 'src/sync/engine.ts',
    find: 'if (canonicalStringify(merged) === canonicalStringify(remoteSnapshot)) {',
    replace: 'if (true) {',
    test: 'src/sync/engine.test.ts',
  },
  {
    id: 'write-does-not-sync',
    failure: 'A local write never triggers a sync (0012 C1, C2)',
    file: 'src/sync/scheduler.ts',
    find: 'this.detachRevision = subscribe(this.onRevision)',
    replace: 'void this.onRevision',
    test: 'src/sync/scheduler.test.ts',
  },
  {
    id: 'currency-default-ignored',
    failure:
      'The app-wide default currency is ignored, so rates preview in the wrong currency (0003 currency resolution)',
    file: 'src/features/entries/EntryForm.tsx',
    find: 'resolveCurrency(project, client, appDefaultCurrency).code',
    replace: 'resolveCurrency(project, client, null).code',
    test: 'src/features/entries/EntryForm.test.tsx',
  },
  {
    id: 'empty-currency-selection',
    failure: 'Clearing the currency list empties every picker instead of widening it (item 13)',
    file: 'src/features/taxonomy/CurrencyPreferences.tsx',
    find: 'chosen.size === 0 || chosen.size === all.length ? null : [...chosen]',
    replace: 'chosen.size === all.length ? null : [...chosen]',
    test: 'src/features/taxonomy/CurrencyPreferences.test.tsx',
  },
  {
    id: 'truncated-backup-imported',
    failure: 'A backup that lost records in transit imports as if complete (0008 J5)',
    file: 'src/export/envelope.ts',
    find: 'if (mismatched.length > 0) {',
    replace: 'if (false) {',
    test: 'src/export/envelope.test.ts',
  },
  {
    id: 'running-entry-uneditable',
    failure:
      'Editing a running entry forces a duration, so the note cannot be fixed without stopping the timer (0004 ED1)',
    file: 'src/features/entries/EntryForm.tsx',
    find: '  const savingAsRunning =\n',
    replace: '  const savingAsRunning = false\n',
    test: 'src/features/entries/EntryForm.test.tsx',
  },
  {
    id: 'manual-entry-while-running',
    failure:
      'A manual entry can be created while a timer runs, so the day double-counts it (0004 M4)',
    file: 'src/app/App.tsx',
    find: '  const timerRunning = timer.running !== null',
    replace: '  const timerRunning = false',
    test: 'src/app/App.test.tsx',
  },
  {
    id: 'sync-warn-contrast',
    failure: 'A sync status colour falls below 3:1, so a status indicator fails SC 1.4.11',
    file: 'src/styles.css',
    find: '--sync-warn: #a86a00;',
    replace: '--sync-warn: #c98a12;',
    test: 'src/domain/taxonomy/colour.styles.test.ts',
  },
]

/** Failures whose code does not exist yet, so they cannot be checked. */
const PENDING = [
  {
    id: 'rounding-before-multiply',
    failure: 'Rounding applied before multiplying by rate (0006 RD4)',
    phase: '6',
  },
  { id: 'float-drift', failure: 'Float drift in money (0003 P3)', phase: '6' },
  {
    id: 'utilisation-divide-by-zero',
    failure: 'Utilisation divide-by-zero (0013 CP-A6)',
    phase: '6',
  },
  { id: 'weekday-off-by-one', failure: 'Weekday off-by-one (0013 K3)', phase: '6' },
  {
    id: 'breakdown-reconciliation',
    failure: 'Breakdown does not reconcile to total (0006 RP2)',
    phase: '6',
  },
  { id: 'csv-quoting', failure: 'CSV quoting missed (0008 C2)', phase: '6' },
  {
    id: 'base-path',
    failure: 'Base path wrong (0002 R1)',
    phase:
      'covered by e2e/smoke.mjs, which reads the base out of dist/index.html rather than repeating it',
  },
]

/**
 * Run one suite and report how it failed.
 *
 * Asynchronous, and that is load-bearing rather than stylistic. `execFileSync` blocks the
 * event loop, and Node does not run a JavaScript signal handler while it is blocked — it
 * simply swallows the signal and carries on. So a synchronous version cannot restore a
 * mutated file on Ctrl-C or on a CI step timeout, which is exactly the case the restore
 * exists for. Verified: `execFileSync` under `SIGTERM` runs to completion and exits 0.
 */
function runVitest(file) {
  return new Promise((resolve) => {
    execFile(
      'npx',
      ['vitest', 'run', file],
      { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ passed: true })
          return
        }
        // A non-zero exit is necessary but not sufficient, and the difference matters: a
        // syntax error or a `describe` block that throws at collection also exits
        // non-zero. Counting that as "caught" would let the gate claim coverage it does
        // not have — the mutation broke the file, not the behaviour. So require a failed
        // *test* as well, which is the claim being made.
        const output = `${stdout}${stderr}`
        const reported = Number(/Tests\s+(\d+) failed/.exec(output)?.[1] ?? 0)
        resolve({ passed: false, testFailed: reported > 0, output })
      },
    )
  })
}

/**
 * The file currently mutated, so a signal can put it back.
 *
 * The `finally` in `checkOne` handles every ordinary failure. It does *not* handle a
 * signal: Node does not run `finally` on `SIGTERM` or `SIGINT`, it just dies. That is not
 * hypothetical — a run cut short by a step timeout left two source files mutated, and the
 * next `npm test` reported two defects that did not exist. The guarantee this script
 * documents therefore needs a signal handler as well as a `finally`.
 *
 * This only works because `runVitest` is asynchronous. Under `execFileSync` the event loop
 * is blocked and Node swallows the signal without ever reaching this handler — verified,
 * a synchronous version ran to completion and exited 0 after `SIGTERM`.
 */
let inFlight = null

function restoreInFlight() {
  if (inFlight === null) return
  const { path, original, file } = inFlight
  inFlight = null
  try {
    writeFileSync(path, original)
    console.error(`\nRestored ${file} after an interrupt.`)
  } catch (error) {
    // Nothing useful is left to do, but saying so beats exiting quietly with a mutated
    // tree the next person will read as real work.
    console.error(`\nCould not restore ${file}: ${String(error)}`)
    console.error('Run `git checkout -- .` before doing anything else.')
  }
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    restoreInFlight()
    // 128 + SIGINT, the conventional shell code for "interrupted".
    process.exit(130)
  })
}

async function checkOne(mutation) {
  const path = join(ROOT, mutation.file)
  if (!existsSync(path)) {
    return { ...mutation, result: 'error', note: `missing file ${mutation.file}` }
  }

  const original = readFileSync(path, 'utf8')
  if (!original.includes(mutation.find)) {
    return {
      ...mutation,
      result: 'stale',
      note: `pattern not found in ${mutation.file} — the code moved, update this script`,
    }
  }

  let outcome
  try {
    writeFileSync(path, original.replace(mutation.find, mutation.replace))
    inFlight = { path, original, file: mutation.file }
    outcome = await runVitest(mutation.test)
  } finally {
    // Restored from the bytes read above, not by reversing the edit, so an edit that
    // applied in more than one place cannot be left half-undone.
    writeFileSync(path, original)
    inFlight = null
  }

  if (outcome.passed) {
    return {
      ...mutation,
      result: 'gap',
      note: `the suite still passed with this bug introduced — ${mutation.test} does not cover it`,
    }
  }
  if (!outcome.testFailed) {
    return {
      ...mutation,
      result: 'error',
      note:
        `${mutation.test} exited non-zero without reporting a failed test — the mutation ` +
        'broke the file rather than the behaviour, so this proves nothing',
    }
  }
  return { ...mutation, result: 'caught' }
}

const filter = process.argv[2] ?? ''
const selected = MUTATIONS.filter((m) => m.id.includes(filter) || m.failure.includes(filter))

console.log(`\nSilent-failure gate — ${selected.length} mutation(s)\n`)

// Sequential, not `Promise.all`. Two mutations of the same file would otherwise race, and
// two suites running at once would make a timing-related flake look like a real result.
const results = []
for (const mutation of selected) {
  results.push(await checkOne(mutation))
}

let gaps = 0
for (const result of results) {
  const mark = result.result === 'caught' ? 'ok  ' : result.result === 'gap' ? 'GAP ' : 'ERR '
  if (result.result !== 'caught') gaps += 1
  console.log(`  ${mark} ${result.id}`)
  console.log(`       ${result.failure}`)
  if (result.note) console.log(`       ${result.note}`)
  console.log(`       via ${result.test ?? result.phase ?? '-'}`)
}

if (!filter) {
  console.log(`\nPending — the code does not exist yet, so these cannot be checked:`)
  for (const item of PENDING) {
    console.log(`  --   ${item.id}`)
    console.log(`       ${item.failure}`)
    console.log(`       ${item.phase}`)
  }
}

console.log(
  `\n${results.filter((r) => r.result === 'caught').length}/${results.length} caught` +
    (gaps > 0 ? `, ${gaps} NOT caught` : '') +
    '\n',
)

process.exit(gaps > 0 ? 1 : 0)
