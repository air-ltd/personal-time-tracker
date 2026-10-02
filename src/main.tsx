import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
// Global styles belong at the entry point, not on a component: they define theme
// tokens used across the whole tree, and keeping them out of App means tests
// render components without pulling in a stylesheet.
import './styles.css'

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
