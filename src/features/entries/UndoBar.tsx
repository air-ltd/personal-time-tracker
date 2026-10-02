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

export function UndoBar({ pending, onUndo }: { pending: PendingDelete; onUndo: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onUndo, AUTO_HIDE_MS)
    return () => window.clearTimeout(id)
  }, [pending.id, onUndo])

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
