/**
 * The "nothing here yet" message.
 *
 * Shared because two components rendered the same sentence with the same
 * `data-testid="empty-state"` — so whichever of them rendered, the other's testid was
 * absent, and a test asserting the empty state passed or failed depending on which
 * component happened to be on screen.
 */
export function EmptyState() {
  return (
    <p className="hint" data-testid="empty-state">
      No entries yet. Start the timer above, or add one by hand.
    </p>
  )
}
