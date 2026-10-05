#!/usr/bin/env node
/**
 * Refuse to let a `VITE_*` secret reach the bundle (0011 AR6, 0002 TC4).
 *
 * Vite inlines every `VITE_*` variable into the JavaScript it builds. That is
 * correct for the Dropbox *client id*, which is public by design under PKCE, and
 * catastrophic for a client *secret*, which cannot be hidden in a static site at
 * all — a `.env.example` note asking people not to do it is advice, and advice is
 * not a control. This turns the note into something that fails a build.
 *
 *   node scripts/check-no-bundled-secrets.mjs
 *
 * Deliberately a separate script from `check-silent-failures.mjs`: that one asks
 * "would the tests notice this bug", this one asks "is this file allowed to
 * exist". Mixing them would make each one harder to read and would mean the
 * mutation gate's 11/11 claim quietly depended on the outcome of a lint.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, extname } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Directories that never contain authored source. */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  '.devcontainer',
  'review',
  'specs',
  'SPECS',
])

/** Files worth reading. Anything else cannot contain a credential reference. */
const SCANNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.html',
])
const SCANNED_NAMES = new Set(['.env.example', 'README.md'])

/**
 * A `VITE_` variable whose name implies it is a secret.
 *
 * Matching on the name rather than on a blocklist is what makes this survive a
 * rename: `VITE_DROPBOX_APP_SECRET`, `VITE_DBX_CLIENT_SECRET` and
 * `VITE_ANYTHING_SECRET` are all caught, and a variable that genuinely is public
 * (the client id) is not.
 */
const SECRET_NAME = /VITE_[A-Z0-9_]*(SECRET|PASSWORD|PRIVATE_KEY|TOKEN|CREDENTIAL)[A-Z0-9_]*/g

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      yield* walk(path)
    } else if (
      entry.startsWith('.env') ||
      SCANNED_EXTENSIONS.has(extname(entry)) ||
      SCANNED_NAMES.has(entry)
    ) {
      // `.env*` is matched by name because `extname('.env')` is `''` — a leading dot
      // reads as the whole name. These files are usually gitignored, which is exactly
      // why they need checking: the value is invisible to review but still inlined
      // into the shipped JavaScript.
      yield path
    }
  }
}

const findings = []
for (const path of walk(ROOT)) {
  const lines = readFileSync(path, 'utf8').split('\n')
  lines.forEach((text, index) => {
    for (const match of text.matchAll(SECRET_NAME)) {
      // A comment is never inlined into the bundle, so a commented-out reference is
      // documentation — this file names the pattern to describe it, and
      // `.env.example` names it to forbid it. Skipping comments is a rule about
      // what can reach a user, not a rule about what may be written down.
      const trimmed = text.trim()
      if (/^(\/\/|\/\*|\*|#)/.test(trimmed)) continue
      // `const FOO = 'VITE_X_SECRET'` is a string literal rather than a real
      // environment read; still worth seeing, but not the same as a declaration.
      const isDeclaration = new RegExp(
        `(import\\.meta\\.env|process\\.env)\\s*\\.\\s*${match[0]}`,
      ).test(text)
      findings.push({
        file: relative(ROOT, path),
        line: index + 1,
        name: match[0],
        declared: isDeclaration,
      })
    }
  })
}

console.log('\nBundled-secret gate — no VITE_* variable may name a secret\n')

if (findings.length === 0) {
  console.log('  ok   no VITE_* secret is declared or referenced\n')
  process.exit(0)
}

for (const finding of findings) {
  console.log(`  ${finding.declared ? 'BAD ' : 'WARN'} ${finding.file}:${finding.line}`)
  console.log(`       ${finding.name}`)
  if (!finding.declared) {
    console.log(
      '       Vite inlines VITE_* into the bundle. A client id is public by design ' +
        '(0011 AR6); anything else here would ship to every visitor.',
    )
  }
}
console.log(
  '\nA static site cannot keep a secret. If this is genuinely needed, it does not ' +
    'belong in a VITE_ variable.\n',
)
process.exit(1)
