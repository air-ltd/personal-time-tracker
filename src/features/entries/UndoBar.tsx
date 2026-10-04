import { useEffect } from 'react'
import { formatDuration } from '../../domain/time/duration'

/**
 * Undo affordance for a soft delete (0003 D3, 0004 L-unset).
 *
 * Soft deletion exists so an accidental delete during review costs one keystroke.
 * The row is still in the database; this only surfaces the restore.
 */
export interface PendingDelete {
  id: string
  label: string
  durationMs: number | null
}

const AUTO_HIDE_MS = 10_000

export function UndoBar({
  pending,
  onUndo,
  onDismiss,
}: {
  pending: PendingDelete
  onUndo: () => void
  /**
   * The window closed without an undo. The deletion stands.
   *
   * Must be a stable reference: the timer below is armed per pending item, and a callback
   * that changes identity on every render would clear and re-arm it each time, so a
   * re-render — a revision bump from an unrelated write — would keep pushing the deadline
   * out and the bar would never close.
   */
  onDismiss: () => void
}) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, AUTO_HIDE_MS)
    return () => window.clearTimeout(id)
  }, [pending.id, onDismiss])

  return (
    <div className="undo-bar" role="status" data-testid="undo-bar">
      <span>
        Deleted {pending.label}
        {pending.durationMs !== null && <> ({formatDuration(pending.durationMs)})</>}
      </span>
      <button type="button" className="button" onClick={onUndo}>
        Undo
      </button>
    </div>
  )
}
