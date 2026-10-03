/*
 * Startup marker, first statement in the entry module.
 *
 * Diagnostic only, and dev-only (`import.meta.env.DEV`) so it never ships. Its
 * purpose is to bisect a blank page: if this line is absent the module never
 * executed at all, which points at the HTML, the asset path or a network failure
 * rather than at anything in the app. If it is present but the page is still
 * blank, the failure is after this point and the next log identifies where.
 *
 * Positioned before every import's side effects by using a static import for
 * `import.meta.env` semantics below — imports are hoisted, so the log cannot truly
 * be the first thing that runs. It is the first statement of this module, which is
 * enough to separate "module did not run" from "module ran and then failed".
 */
if (import.meta.env.DEV) {
  console.log('[tt] main.tsx executing', {
    href: window.location.href,
    root: document.getElementById('root') !== null,
    base: import.meta.env.BASE_URL,
  })
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { completeAuthFromRedirect } from './sync/oauthCallback'
// Global styles belong at the entry point, not on a component: they define theme
// tokens used across the whole tree, and keeping them out of App means tests
// render components without pulling in a stylesheet.
import './styles.css'

// The OAuth redirect returns to this page with `code` and `state` in the query
// string, which the hash router would otherwise ignore. Handled before render so
// the token is stored before the app tries to sync.
void completeAuthFromRedirect()

const container = document.getElementById('root')
if (!container) {
  // Failing loudly beats rendering into nothing.
  throw new Error('Missing #root element')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.DEV) {
  console.log('[tt] main.tsx completed, React mounted')
}
