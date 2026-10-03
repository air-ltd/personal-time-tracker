import { useCallback, useEffect, useMemo, useState } from 'react'
import { matchPath, usePath, type Route } from './router'
import { ThemeToggle } from './ThemeToggle'
import {
  applyTheme,
  readStoredPreference,
  storePreference,
  type ThemePreference,
} from './theme'
import { TimerPanel } from '../features/timer/TimerPanel'
import { useTimer } from '../features/timer/useTimer'
import { EntryList } from '../features/entries/EntryList'
import { EntryForm } from '../features/entries/EntryForm'
import { UndoBar, type PendingDelete } from '../features/entries/UndoBar'
import { SyncPanel } from '../features/sync/SyncPanel'
import { getEntry, restoreEntry, softDeleteEntry } from '../storage/entriesRepo'
import { entryDurationMs } from '../domain/time/duration'
import type { TimeEntry } from '../domain/entries/types'

/**
 * Routes. The only nested path is an entry id, so a hand-rolled table beats
 * pulling in a router for three entries (0002 DEP3, 0002 R1: hash-based because
 * GitHub Pages does not rewrite requests).
 */
const ROUTES: readonly Route[] = [
  { path: '/' },
  { path: '/entries/new' },
  { path: '/entries/:id' },
]

/** Entries display elapsed time, so this needs to advance while a timer runs. */
const CLOCK_MS = 30_000

export function App() {
  const path = usePath()
  const match = useMemo(() => matchPath(path, ROUTES), [path])

  const [theme, setTheme] = useState<ThemePreference>(readStoredPreference)
  const [now, setNow] = useState(() => new Date())
  const [pending, setPending] = useState<PendingDelete | null>(null)
  const [loadedEdit, setLoadedEdit] = useState<{
    id: string
    entry: TimeEntry | null
  } | null>(null)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), CLOCK_MS)
    return () => window.clearInterval(id)
  }, [])

  const onThemeChange = useCallback((next: ThemePreference) => {
    storePreference(next)
    setTheme(next)
  }, [])

  // The unload warning lives in TimerPanel, which owns the timer state and the
  // "don't remind me" control. Registering it here as well gave two independent
  // instances with separate dismissal state, so dismissing the prompt in the panel
  // left this copy still firing.
  const timer = useTimer()

  // 0001 US2: stopping routes to the entry form, so classification happens while
  // the work is still fresh.
  const onStopped = useCallback((id: string) => {
    window.location.hash = `/entries/${id}`
  }, [])

  // Load the entry being edited. `undefined` means "not resolved yet", which is
  // distinct from `null` for "no such entry".
  const editId = match?.params['id']
  useEffect(() => {
    if (!editId || editId === 'new') return
    let cancelled = false
    void getEntry(editId).then((entry) => {
      if (!cancelled) setLoadedEdit({ id: editId, entry: entry ?? null })
    })
    return () => {
      cancelled = true
    }
  }, [editId])

  // Derived rather than reset in an effect: `undefined` means not resolved yet,
  // `null` means no such entry, and the three states must stay distinguishable.
  const editing = loadedEdit !== null && loadedEdit.id === editId ? loadedEdit.entry : undefined

  const onDelete = useCallback((entry: TimeEntry) => {
    void softDeleteEntry(entry.id, new Date()).then(() => {
      setPending({
        id: entry.id,
        label: entry.note || 'entry',
        durationMs: entryDurationMs(entry, new Date()),
      })
      window.location.hash = '/'
    })
  }, [])

  const onUndo = useCallback(() => {
    if (!pending) return
    const target = pending
    setPending(null)
    void restoreEntry(target.id, new Date())
  }, [pending])

  return (
    <div className="app">
      <header className="app-header">
        <h1>Time Tracker</h1>
        <ThemeToggle value={theme} onChange={onThemeChange} />
      </header>

      <main className="app-main">
        {match?.route.path === '/' && (
          <>
            <TimerPanel timer={timer} onStopped={onStopped} />
            <div className="panel">
              <div className="panel-header">
                <h2>Entries</h2>
                <a className="button" href="#/entries/new">
                  Add entry
                </a>
              </div>
              <EntryList now={now} />
            </div>
            <SyncPanel />
          </>
        )}

        {match?.route.path === '/entries/new' && <EntryForm now={now} />}

        {match?.route.path === '/entries/:id' &&
          (editing === undefined ? (
            <p className="hint">Loading…</p>
          ) : editing === null ? (
            <div className="panel">
              <h2>Entry not found</h2>
              <p className="hint">
                It may have been deleted. <a href="#/">Back to entries</a>.
              </p>
            </div>
          ) : (
            <EntryForm entry={editing} now={now} onDelete={onDelete} />
          ))}

        {!match && (
          <section>
            <h2>Page not found</h2>
            <p>
              Nothing is routed at <code>{path}</code>.
            </p>
            <p>
              <a href="#/">Back to the start</a>
            </p>
          </section>
        )}
      </main>

      {pending && <UndoBar pending={pending} onUndo={onUndo} />}
    </div>
  )
}
