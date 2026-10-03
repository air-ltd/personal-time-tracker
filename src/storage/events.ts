/**
 * Change notification.
 *
 * There is no server and no reactive query library, so writes publish a revision
 * bump and views re-read. This keeps IndexedDB the single source of truth (0002 S2)
 * rather than letting a component hold a second copy that can drift.
 */

let revision = 0
const listeners = new Set<() => void>()

export function bumpRevision(): void {
  revision += 1
  for (const listener of listeners) listener()
}

export function getRevision(): number {
  return revision
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test helper: forget all subscribers and reset the revision. */
export function resetRevisionForTests(): void {
  revision = 0
  listeners.clear()
}
