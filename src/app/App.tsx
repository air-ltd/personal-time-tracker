import { useCallback, useEffect, useState } from 'react'
import { matchRoute, usePath } from './router'
import {
  applyTheme,
  readStoredPreference,
  storePreference,
  type ThemePreference,
} from './theme'
import { ThemeToggle } from './ThemeToggle'

/**
 * Route table (0002 R2, R3).
 *
 * `/` is the only real route at Phase 1. Further routes arrive with their
 * features in Phases 4–6; an unknown path renders a not-found view inside the
 * shell rather than throwing.
 */
const ROUTES = [{ path: '/' }] as const

function NotFound({ path }: { path: string }) {
  return (
    <section>
      <h2>Page not found</h2>
      <p>
        Nothing is routed at <code>{path}</code>.
      </p>
      <p>
        <a href="#/">Back to the start</a>
      </p>
    </section>
  )
}

function Placeholder() {
  return (
    <section>
      <h2>Nothing here yet</h2>
      <p>
        This is the Phase 1 shell. It exists to prove the build, the hash routing and the GitHub
        Pages base path work before any feature is built on top. See{' '}
        <code>SPECS/0014-development-plan.md</code>.
      </p>
    </section>
  )
}

export function App() {
  const path = usePath()
  const [theme, setTheme] = useState<ThemePreference>(readStoredPreference)

  // Apply on mount, and on every subsequent change. The inline script in
  // index.html has already set the attribute before first paint; this keeps it in
  // sync afterwards (0002 TH4).
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // Track the OS preference live so `system` follows it without a reload
  // (0002 TH5).
  useEffect(() => {
    if (theme !== 'system') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [theme])

  const onThemeChange = useCallback((next: ThemePreference) => {
    storePreference(next)
    setTheme(next)
  }, [])

  const matched = matchRoute(path, ROUTES)

  return (
    <div className="app">
      <header className="app-header">
        <h1>Time Tracker</h1>
        <ThemeToggle value={theme} onChange={onThemeChange} />
      </header>
      <main className="app-main">{matched ? <Placeholder /> : <NotFound path={path} />}</main>
    </div>
  )
}
