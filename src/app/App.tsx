import { useCallback, useEffect, useMemo, useState } from 'react'
import { matchPath, usePath, type Route } from './router'
import {
  applyTheme,
  readStoredPreference,
  storePreference,
  type ThemePreference,
} from './theme'
import { TimerPanel } from '../features/timer/TimerPanel'
import { useTimer } from '../features/timer/useTimer'
import { EntriesView } from '../features/entries/EntriesView'
import { EntryForm } from '../features/entries/EntryForm'
import { UndoBar, type PendingDelete } from '../features/entries/UndoBar'
import { SyncIndicator } from '../features/sync/SyncIndicator'
import { SyncProvider } from '../features/sync/SyncProvider'
import { SettingsPage } from '../features/settings/SettingsPage'
import { AboutPage } from './AboutPage'
import { HeaderMenu } from '../features/settings/HeaderMenu'
import { getEntry, restoreEntry, softDeleteEntry } from '../storage/entriesRepo'
import { entryDurationMs } from '../domain/time/duration'
import { appHomeUrl } from '../sync/redirect'
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
  { path: '/settings' },
  { path: '/about' },
]

/** Entries display elapsed time, so this needs to advance while a timer runs. */
const CLOCK_MS = 30_000

export function App() {
  const path = usePath()
  const match = useMemo(() => matchPath(path, ROUTES), [path])

  const [theme, setTheme] = useState<ThemePreference>(readStoredPreference)
  const [now, setNow] = useState(() => new Date())
  const [pending, setPending] = useState<PendingDelete | null>(null)
  // Item 25: which client's entries are shown. Set from the timer card.
  const [clientFilter, setClientFilter] = useState<string | null>(null)
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

  // Stable, because the bar arms its auto-hide timer per pending item and a fresh
  // function each render would re-arm it and the bar would never close.
  const onDismiss = useCallback(() => setPending(null), [])

  const onUndo = useCallback(() => {
    if (!pending) return
    const target = pending
    setPending(null)
    void restoreEntry(target.id, new Date())
  }, [pending])

  return (
    <SyncProvider>
      <div className="app">
        <header className="app-header">
          {/*
            Items 11, 15 and 23: the title links to the app's own home, resolved relative
            to wherever it is served rather than to the deployed host, and the favicon sits
            to its left doing the same job.

            The title stays the site's name rather than becoming the link itself: a heading
            that is also a home link reads as "you are here" on every screen. The icon is
            the way back, and it is marked decorative because the link already has a name.
          */}
          <h1>
            <a className="app-home" href={appHomeUrl()} aria-label="Time Tracker, home">
              <img
                className="app-home-icon"
                src={`${import.meta.env.BASE_URL}favicon.svg`}
                alt=""
                width="36"
                height="36"
              />
              <span>Time Tracker</span>
            </a>
          </h1>
          <div className="app-header-controls">
            {/* Item 10: the header says whether this device is connected, and offers the
              one action that makes sense when it is not. The detail is on the settings
              page, so this does not grow into a panel on every screen. */}
            <SyncIndicator />
            {/* Item 18: settings and backup/recovery live behind one menu, so the header
                stops growing a button for every setting and the entries get the room back.
                0005 P1 still holds — the menu is one interaction, then the form is the
                second. */}
            <HeaderMenu settingsHref="#/settings" />
          </div>
        </header>

        <main className="app-main">
          {match?.route.path === '/' && (
            <>
              {/* Item 25: the client is chosen by pressing its line on the timer card, and
                  that choice filters the entries below. Held here because two cards act on
                  it. */}
              <TimerPanel
                timer={timer}
                onStopped={onStopped}
                now={now}
                selectedClientId={clientFilter}
                onSelectClient={setClientFilter}
              />
              <EntriesView now={now} selectedClientId={clientFilter} />
            </>
          )}

          {match?.route.path === '/entries/new' && <EntryForm now={now} />}

          {match?.route.path === '/settings' && (
            <SettingsPage now={now} theme={theme} onThemeChange={onThemeChange} />
          )}

          {match?.route.path === '/about' && <AboutPage />}

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

        {pending && <UndoBar pending={pending} onUndo={onUndo} onDismiss={onDismiss} />}
      </div>
    </SyncProvider>
  )
}
