import { useCallback, useEffect, useState } from 'react'

/**
 * Unload behaviour while a timer runs (0004 W1–W7).
 *
 * The default is to keep running. The prompt exists so an accidental close is
 * noticed, not to stop time being tracked: dismissing it and confirming the leave
 * both leave the timer running (W3). Leaving must never silently discard elapsed
 * time, which is also why the timer is a wall-clock span rather than a counter.
 */

export interface UnloadWarningOptions {
  /** True only while a timer is running. */
  active: boolean
  /**
   * Identifies the current timer. A change means a new session, which clears a
   * previous suppression (0004 W6).
   */
  sessionKey?: string | null
  /** Last reliable hook before a tab is discarded; Phase 2B flushes sync here. */
  onUnload?: () => void
}

export interface UnloadWarning {
  dismissed: boolean
  dismiss: () => void
}

interface Dismissal {
  sessionKey: string | null
  dismissed: boolean
}

export function useUnloadWarning({
  active,
  sessionKey,
  onUnload,
}: UnloadWarningOptions): UnloadWarning {
  const key = sessionKey ?? null
  const [state, setState] = useState<Dismissal>({ sessionKey: key, dismissed: false })

  // W6: suppression belongs to one session, not forever. Derived from which
  // session it was recorded against rather than reset inside an effect, so a new
  // timer warns again without a cascading render on every change.
  const dismissed = state.sessionKey === key && state.dismissed

  // W1 / W5: prompt only while a timer runs. A permanent handler would prompt on
  // every navigation, and a habit of dismissing it reflexively would defeat the
  // prompt when it actually matters.
  useEffect(() => {
    if (!active || dismissed) return

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      // W4: only the browser's own dialog can block, so trigger that rather than
      // attempting a custom modal, which the browser will not show anyway.
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)

    // W7: pagehide is the more reliable of the two on mobile browsers, and is the
    // last moment a pending sync can be flushed.
    const onPageHide = () => {
      onUnload?.()
    }
    window.addEventListener('pagehide', onPageHide)

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [active, dismissed, onUnload])

  const dismiss = useCallback(() => setState({ sessionKey: key, dismissed: true }), [key])

  return { dismissed, dismiss }
}
