import { copyFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Base path for the built site.
 *
 * 0002 R1 requires this to come from configuration rather than a literal in
 * source, and B5 forbids hard-coding a `github.io` host. Deriving it from the
 * package name means a project site at `/<repo>/` works by default, an override
 * is available for a user or organisation site served from the root, and no
 * host name is baked in.
 */
const pkgName = (await import('./package.json', { with: { type: 'json' } })).default.name
const base = process.env.VITE_BASE_PATH ?? `/${pkgName}/`

/**
 * Emit `404.html` alongside `index.html`.
 *
 * Hash routing is what actually makes deep links work here (0002 R1), since
 * GitHub Pages performs no request rewriting. This is defence in depth for
 * 0002 R4: if a later change reintroduces path routing, the site still resolves
 * instead of hard 404-ing.
 */
function pagesSpaFallback() {
  return {
    name: 'pages-spa-fallback',
    apply: 'build' as const,
    closeBundle() {
      const outDir = resolve(import.meta.dirname, 'dist')
      const index = resolve(outDir, 'index.html')
      if (existsSync(index)) {
        copyFileSync(index, resolve(outDir, '404.html'))
      }
    },
  }
}

/**
 * Origins the app is permitted to talk to.
 *
 * 0011 N1 allows exactly one provider's API and nothing else, so these are the
 * only two hostnames that may appear in `connect-src`. They are duplicated from
 * `src/sync/dropbox/config.ts` on purpose: a build script cannot import
 * application source without dragging TypeScript into the config loader, and a
 * second copy that a test can compare is safer than one that has silently
 * drifted. `e2e/smoke.mjs` asserts the served policy matches the provider URLs.
 */
const CSP_CONNECT_ORIGINS = ['https://api.dropboxapi.com', 'https://content.dropboxapi.com']

/**
 * SHA-256 of each inline script's text, as CSP source expressions.
 *
 * The theme bootstrap in `index.html` has to be inline: it runs before any module
 * is fetched, because IndexedDB cannot be read synchronously (0002 TH4). Rather
 * than pay for `script-src 'unsafe-inline'` — which would let an injected string
 * execute, defeating most of what the policy is for — the inline script is
 * allow-listed by content hash, which stays correct as long as the script is not
 * edited.
 *
 * Computing the hash from the emitted HTML rather than copying it here means the
 * allow-list cannot fall out of step with the script it describes. CSP hashes the
 * script element's text content exactly as it appears, so the leading newline and
 * indentation are part of the input and must not be trimmed.
 */
function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = []
  // `<script>` with no `src` attribute. The negative lookahead keeps external
  // module scripts out; Vite has already rewritten those to hashed asset URLs by
  // the time this runs, and they are covered by 'self'.
  for (const match of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const text = match[1]
    if (text === undefined) continue
    hashes.push(`'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`)
  }
  return hashes
}

/**
 * Deliver 0011 N5 as a `<meta http-equiv>` policy.
 *
 * GitHub Pages serves static files and cannot set response headers, and a
 * project site is served from `https://<user>.github.io/<repo>/`, so a
 * `'self'` script source correctly covers the hashed module chunks it loads.
 * `404.html` is a copy of the built `index.html` (see `pagesSpaFallback`), so
 * one insertion covers the deep-link fallback too.
 *
 * Injected at build time rather than committed to `index.html`, because the dev
 * server rewrites `index.html` on every request and injects its own inline
 * preamble for React Fast Refresh. A policy strict enough to be worth having
 * would break `npm run dev`, and a policy loosened for the dev server would be no
 * policy at all. The dev server's own protections apply instead.
 *
 * `frame-ancestors` is deliberately absent: CSP silently ignores it when
 * delivered via `<meta>`, so including it would read as clickjacking protection
 * that does not exist. 0011 records that limitation rather than implying
 * otherwise.
 */
function contentSecurityPolicy() {
  const build = (html: string): string =>
    [
      "default-src 'self'",
      // 'unsafe-inline' is required by the inline `style` attributes React sets
      // for project and tag colour dots. That is a styling capability with no
      // access to data; the exfiltration channel N5 exists to close is
      // `connect-src`, which is not relaxed.
      "style-src 'self' 'unsafe-inline'",
      `script-src 'self' ${inlineScriptHashes(html).join(' ')}`,
      `connect-src 'self' ${CSP_CONNECT_ORIGINS.join(' ')}`,
      "img-src 'self' data:",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      // No form is ever submitted and no third-party page is framed; the Dropbox
      // OAuth consent screen is a top-level navigation, which `form-action` does
      // not govern. Listed so that adding one of either has to remove this line.
      "form-action 'none'",
    ].join('; ')

  return {
    name: 'content-security-policy',
    apply: 'build' as const,
    transformIndexHtml: {
      // After Vite's own HTML processing, so the emitted markup — including any
      // inline script it added — is what gets hashed.
      order: 'post' as const,
      handler(html: string) {
        const meta = `<meta http-equiv="Content-Security-Policy" content="${build(html)}" />`
        // Immediately after the charset declaration, and before the theme
        // bootstrap, because a `<meta>` policy only governs content parsed after
        // it. Inserting before `</head>` would leave the bootstrap uncovered and
        // lock the page into the light theme.
        return html.replace(/(<meta charset="UTF-8"[^>]*>)/i, `$1\n    ${meta}`)
      },
    },
  }
}

export default defineConfig({
  base,
  plugins: [react(), contentSecurityPolicy(), pagesSpaFallback()],
  build: {
    // 0009 C4: source maps are not published. This app holds personal data and
    // there is no reason to expose internals.
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    // Globals are off deliberately. With them on, `describe` and `expect` are in scope
    // for production code as well, so a stray call in app code type-checks and only
    // fails at runtime. Every test imports what it uses instead.
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    env: {
      // Pinned so the DST assertions mean the same thing everywhere. On a CI
      // runner set to UTC, a spring-forward test would compare 24h against 24h
      // and pass without ever exercising a transition (0006 DT3, 0010 Priority 1).
      // Europe/London transitions at 01:00 GMT on the last Sunday of March and
      // October, which the day-arithmetic tests target explicitly.
      TZ: 'Europe/London',
    },
  },
})
