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

import { execFileSync } from 'node:child_process'
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
    replace:
      'data: z.object({ ...entityTables, secrets: z.array(z.looseObject({}).default([]) }),',
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
    find: "  'entries',\n  'projects',",
    replace: "  'projects',",
    test: 'src/storage/snapshotRepo.test.ts',
  },
  {
    id: 'revision-not-bumped',
    failure: 'Data written by sync or restore never reaches the view (0012 C8)',
    file: 'src/storage/snapshotRepo.ts',
    find: 'if (wrote) bumpRevision()',
    replace: 'if (false) bumpRevision()',
    test: 'src/storage/snapshotRepo.test.ts',
  },
  {
    id: 'push-skipped',
    failure: 'Local-only changes never reach the provider (0012 C5)',
    file: 'src/sync/engine.ts',
    find: 'if (canonicalStringify(outcome.merged) === canonicalStringify(remoteSnapshot)) {',
    replace: 'if (true) {',
    test: 'src/sync/engine.test.ts',
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
    failure: 'Base path wrong (0002 B2)',
    phase: 'covered by e2e/smoke.mjs, which loads the built site at /personal-time-tracker/',
  },
]

function runVitest(file) {
  try {
    execFileSync('npx', ['vitest', 'run', file], { cwd: ROOT, stdio: 'pipe' })
    return { passed: true }
  } catch (error) {
    // A non-zero exit is the expected outcome: the mutation must be caught.
    return { passed: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

function checkOne(mutation) {
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
    outcome = runVitest(mutation.test)
  } finally {
    // Restored from the bytes read above, not by reversing the edit, so an interrupted
    // run cannot leave a mutated file behind.
    writeFileSync(path, original)
  }

  if (outcome.passed) {
    return {
      ...mutation,
      result: 'gap',
      note: `the suite still passed with this bug introduced — ${mutation.test} does not cover it`,
    }
  }
  return { ...mutation, result: 'caught' }
}

const filter = process.argv[2] ?? ''
const selected = MUTATIONS.filter((m) => m.id.includes(filter) || m.failure.includes(filter))

console.log(`\nSilent-failure gate — ${selected.length} mutation(s)\n`)

const results = selected.map(checkOne)

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
