import { useEffect } from 'react'
import { AUTO_HIDE_MS } from '../entries/undoWindow'

/**
 * Undo for a taxonomy deletion (0005 X5).
 *
 * Separate from the entry `UndoBar` because the receipt is not an entry id: undoing
 * restores a record *and* the references the deletion cleared, which is a different shape
 * of thing to put a countdown on. The window is shared, not re-derived — see `undoWindow`.
 *
 * Takes a finished sentence rather than a receipt. The caller knows what kind of record
 * it deleted and what that did to its entries, and the only reason to reach past it would
 * be to re-derive that — which is how this ends up narrowing a union it does not own.
 */

export interface TaxonomyUndo {
  /** What was deleted, e.g. `project "Acme"`. */
  label: string
  /** The consequence, e.g. `3 entries are now uncategorised`. */
  detail: string | null
}

export interface ProjectUndoBarProps {
  pending: TaxonomyUndo
  onUndo: () => void
  /**
   * The window closed without an undo. The deletion stands.
   *
   * Must be a stable reference; see the note in the entry `UndoBar` on why a per-render
   * callback would let the bar outlive its own window.
   */
  onDismiss: () => void
}

export function ProjectUndoBar({ pending, onUndo, onDismiss }: ProjectUndoBarProps) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, AUTO_HIDE_MS)
    return () => window.clearTimeout(id)
  }, [pending.label, onDismiss])

  return (
    <div className="undo-bar" role="status" data-testid="undo-bar">
      <span>
        Deleted {pending.label}
        {pending.detail && <> — {pending.detail}</>}
      </span>
      <button type="button" className="button" onClick={onUndo}>
        Undo
      </button>
    </div>
  )
}
