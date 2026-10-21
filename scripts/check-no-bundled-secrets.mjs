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

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
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

/**
 * The `VITE_` variables this project is allowed to use at all.
 *
 * An allowlist rather than a blocklist of secret-looking names, because a name is not
 * the only thing that makes a value sensitive — and because a *blocklist* of names says
 * nothing about a variable the blocklist has not heard of.
 *
 * Both of these are public by construction:
 *
 * - `VITE_DROPBOX_APP_KEY` is an OAuth **client id**, which is not a secret and is
 *   meant to be seen by the browser (0011 AR6).
 * - `VITE_BASE_PATH` is the sub-path the site is served from, read at build time.
 *
 * Anything else named `VITE_` is inlined into the shipped JavaScript, whether or not
 * the source refers to it — Vite writes the whole environment into the `import.meta.env`
 * object literal, so a variable present only in the build environment still ships. A
 * blocklist of secret-ish names cannot catch that; an allowlist can.
 */
const ALLOWED_VITE_NAMES = new Set(['VITE_DROPBOX_APP_KEY', 'VITE_BASE_PATH'])

/** Every `VITE_` name mentioned, whether or not it looks like a secret. */
const ANY_VITE_NAME = /VITE_[A-Z0-9_]+/g

/**
 * Whether a line is a comment.
 *
 * A comment is never inlined into the bundle, so a commented-out reference is
 * documentation — this file names the pattern to describe it, and `.env.example`
 * names it to forbid it. Skipping comments is a rule about what can reach a user,
 * not a rule about what may be written down.
 */
function isCommentLine(text) {
  return /^(\/\/|\/\*|\*|#)/.test(text.trim())
}

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

/**
 * Every file under a directory, ignoring nothing.
 *
 * Used for the built output, where the point is to read the files that were actually
 * produced — so the source scan's skip list does not apply. `node_modules` is still
 * skipped, because a dependency's own environment handling is not this project's to
 * police, and a bundled dependency is not where a `VITE_` value from *this* build
 * would be written.
 */
function* walkDir(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      yield* walkDir(path)
    } else {
      yield path
    }
  }
}

const findings = []
const unlisted = []

for (const path of walk(ROOT)) {
  // This file names the patterns on purpose, so scanning it would find its own
  // regular expressions. The built output is still scanned — that is where a value
  // would actually ship.
  if (path === fileURLToPath(import.meta.url)) continue

  const lines = readFileSync(path, 'utf8').split('\n')
  lines.forEach((text, index) => {
    const trimmed = text.trim()
    if (isCommentLine(text)) return

    for (const match of text.matchAll(SECRET_NAME)) {
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

    // Every `VITE_` name, whatever it is called, must be on the allowlist.
    for (const match of text.matchAll(ANY_VITE_NAME)) {
      if (ALLOWED_VITE_NAMES.has(match[0])) continue
      unlisted.push({ file: relative(ROOT, path), line: index + 1, name: match[0] })
    }
  })
}

/*
 * The built output, when it exists.
 *
 * This is the half that catches the case a source scan cannot: a `VITE_` variable that
 * is present in the *build environment* and referred to by no source file. Vite writes
 * the whole environment into the `import.meta.env` object literal, so such a variable
 * ships in the bundle even though nothing in the repository mentions it.
 *
 * The scan runs on the built files rather than on the source, because that is where
 * the value actually is.
 */
const distFindings = []
const distDir = join(ROOT, 'dist')
if (existsSync(distDir)) {
  for (const path of walkDir(distDir)) {
    if (!/\.(js|mjs|cjs|html|json)$/.test(path)) continue
    const text = readFileSync(path, 'utf8')
    for (const match of text.matchAll(ANY_VITE_NAME)) {
      if (ALLOWED_VITE_NAMES.has(match[0])) continue
      distFindings.push({ file: relative(ROOT, path), name: match[0] })
    }
  }
}

console.log('\nBundled-secret gate — only allowlisted VITE_* variables may exist\n')

if (findings.length === 0 && unlisted.length === 0 && distFindings.length === 0) {
  console.log('  ok   no VITE_* secret is declared or referenced')
  console.log(
    `  ok   every VITE_* variable is allowlisted (${[...ALLOWED_VITE_NAMES].join(', ')})`,
  )
  console.log('  ok   the built output contains no other VITE_* variable\n')
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

for (const finding of unlisted) {
  console.log(`  BAD  ${finding.file}:${finding.line}`)
  console.log(`       ${finding.name}`)
  console.log('       Not on the allowlist, and Vite inlines every VITE_* variable.')
}

for (const finding of distFindings) {
  console.log(`  BAD  ${finding.file}`)
  console.log(`       ${finding.name}`)
  console.log(
    '       Present in the built output. Vite inlines every VITE_* variable in the ' +
      'build environment, whether or not the source refers to it.',
  )
}

console.log(
  '\nA static site cannot keep a secret. If this is genuinely needed, it does not ' +
    'belong in a VITE_ variable.\n',
)
process.exit(1)
