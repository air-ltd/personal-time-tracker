import { useUnloadWarning } from '../timer/useUnloadWarning'
import { formatDuration } from '../../domain/time/duration'
import type { TimerState } from '../timer/useTimer'

/**
 * Timer panel: the one thing a user touches most often.
 *
 * Stopping hands the entry id back so the caller can route to the detail form,
 * where classification happens while the work is still fresh (0001 US2). That
 * keeps this panel a single-purpose control.
 *
 * The timer state is owned by the caller rather than created here, so the whole
 * app shares one subscription and one derived elapsed value.
 */
export interface TimerPanelProps {
  timer: TimerState
  /**
   * Called after the entry has been written, not before.
   *
   * The write is asynchronous, so navigating first races it: the edit route reads the
   * entry back immediately, finds nothing, and renders "Entry not found" — and because
   * the id does not change, the load never runs again and the message sticks even though
   * the entry was saved a moment later.
   */
  onStopped: (id: string) => void | Promise<void>
}

export function TimerPanel({ timer, onStopped }: TimerPanelProps) {
  const { running, elapsedMs, start, stop, discard } = timer
  const { dismissed, dismiss } = useUnloadWarning({
    active: running !== null,
    // Resetting the dismissal per timer implements 0004 W6: "don't remind me"
    // applies to this session, not to every session afterwards.
    sessionKey: running?.id ?? null,
  })

  const handleStop = async () => {
    if (!running) return
    // Awaited before navigating. The write is asynchronous, so navigating first races
    // the read the edit route immediately performs.
    await stop()
    await onStopped(running.id)
  }

  return (
    <section className="panel timer-panel" aria-labelledby="timer-heading">
      <h2 id="timer-heading">Timer</h2>

      {running ? (
        <>
          <p className="timer-elapsed" data-testid="timer-elapsed">
            <span className="visually-hidden">Elapsed </span>
            {formatDuration(elapsedMs, { seconds: true })}
          </p>
          <p className="timer-started">
            Started <time dateTime={running.start}>{formatStart(running.start)}</time>
          </p>
          <div className="button-row">
            <button
              type="button"
              className="button button-primary"
              onClick={() => void handleStop()}
            >
              Stop
            </button>
            <button type="button" className="button" onClick={discard}>
              Discard
            </button>
          </div>
          {!dismissed && (
            <p className="hint">
              Closing this tab keeps the timer running.{' '}
              <button type="button" className="link-button" onClick={dismiss}>
                Don&apos;t remind me
              </button>
            </p>
          )}
        </>
      ) : (
        <>
          <p className="timer-elapsed timer-idle" data-testid="timer-elapsed">
            No timer running
          </p>
          <button type="button" className="button button-primary" onClick={start}>
            Start
          </button>
        </>
      )}
    </section>
  )
}

function formatStart(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso))
}
