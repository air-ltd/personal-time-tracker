#!/usr/bin/env node
/**
 * Every requirement id cited in a comment must exist.
 *
 * A citation like `0004 V1` is only worth writing if a reader can follow it. This codebase's
 * comment style is built on citing the requirement and the failure it prevents, so the
 * citation *is* the value — and a citation pointing at an id that no longer exists is the
 * one comment a reader cannot check. Ten of them did: `0002 B1` and `0002 B2` survived a
 * restructure that replaced the `B` prefix with `R`, and `0005 F4` was cited from three
 * files for a requirement that only ever existed in `0003`.
 *
 * The same shape as `snapshotRepo.test.ts`'s table check: a thing that can be added without
 * being mentioned here fails this rather than passing.
 *
 *   node scripts/check-citations.mjs
 *
 * Reads only files that are linted or typechecked. Prose (`SPECS/`, `docs/`, the READMEs)
 * is excluded, because a spec explaining an earlier version of itself is not drift.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const SOURCE_DIRS = ['src', 'e2e', 'scripts']
const SOURCE_FILES = ['vite.config.ts', 'eslint.config.js']
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs'])

/** `NNNN XX`, `NNNN XX.Y` and `NNNN XX–YY` ranges. */
const CITATION = /\b(\d{4})\s+([A-Z]{1,3}\d+(?:\.\d+)?)\b/g

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* walk(path)
    else if (SOURCE_EXTENSIONS.has(extname(path))) yield path
  }
}

/**
 * The ids each spec actually defines.
 *
 * Read from the `**XX9** —` requirement headings, with the document's own number taken
 * from its filename rather than from the text — the file *is* the spec, and a spec that
 * renamed itself would otherwise silently invalidate every citation to it.
 */
function definedIds() {
  const ids = new Set()
  const specDir = join(ROOT, 'SPECS')
  for (const file of readdirSync(specDir)) {
    if (!file.endsWith('.md') || file === 'README.md' || file === 'todo.md') continue
    const number = /^(\d{4})-/.exec(file)?.[1]
    if (!number) continue
    const text = readFileSync(join(specDir, file), 'utf8')
    /*
     * Requirement headings, in the two shapes the specs use:
     *   `**V1** — text`   (the dash outside the bold)
     *   `**AR1 — text**`  (the dash inside the bold)
     * with either a list marker, and in 0001's case not bold at all.
     *
     * Deliberately anchored to the dash. Bold text inside prose discusses ids rather than
     * defining them, and matching that would let any file's own discussion of an id count
     * as a second definition — which would make the whole gate pass.
     */
    const shapes = [
      /^(?:[-*]\s+)?\*\*([A-Z]{1,3}\d+(?:\.\d+)?)\*\*\s+—/gm,
      /^(?:[-*]\s+)?\*\*([A-Z]{1,3}\d+(?:\.\d+)?)\s+—[^*]*\*\*/gm,
      /^- ([A-Z]{1,3}\d+(?:\.\d+)?)\s+—/gm,
    ]
    for (const shape of shapes) {
      for (const match of text.matchAll(shape)) {
        ids.add(`${number} ${match[1]}`)
      }
    }
  }
  return ids
}

const defined = definedIds()

const files = [
  ...SOURCE_DIRS.flatMap((dir) => [...walk(join(ROOT, dir))]),
  ...SOURCE_FILES.map((file) => join(ROOT, file)),
  // Excluded from its own scan. This file names unresolvable ids on purpose, to explain
  // what the gate is for, and those examples would otherwise be reported as drift. Any
  // real citation added here would go unchecked — which is the cost, stated rather than
  // hidden.
].filter((path) => !path.endsWith('check-citations.mjs'))

const unresolved = []
for (const path of files) {
  const lines = readFileSync(path, 'utf8').split('\n')
  lines.forEach((text, index) => {
    for (const match of text.matchAll(CITATION)) {
      const id = `${match[1]} ${match[2]}`
      if (!defined.has(id)) {
        unresolved.push({ file: relative(ROOT, path), line: index + 1, id, text: text.trim() })
      }
    }
  })
}

console.log(`\nCitation gate — ${defined.size} requirement ids defined across SPECS/\n`)

if (unresolved.length === 0) {
  console.log(`  ok   every citation in ${files.length} source files resolves\n`)
  process.exit(0)
}

for (const finding of unresolved) {
  console.log(`  BAD  ${finding.file}:${finding.line}`)
  console.log(`       ${finding.id} is not defined in SPECS/`)
  console.log(`       ${finding.text}`)
}
console.log(
  `\n${unresolved.length} citation(s) resolve to nothing. Either the id was renamed in the\n` +
    'spec, or the comment means a different requirement. Check the spec before guessing.\n',
)

// Exit code kept for a caller that wants it; the script also prints, because CI logs are
// read and exit codes are not.
void execFileSync
process.exit(1)
