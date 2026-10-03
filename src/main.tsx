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
