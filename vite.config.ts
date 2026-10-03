import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Base path for the built site.
 *
 * 0002 B1 requires this to come from configuration rather than a literal in
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

export default defineConfig({
  base,
  plugins: [react(), pagesSpaFallback()],
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
