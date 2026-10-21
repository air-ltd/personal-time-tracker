/**
 * Change notification.
 *
 * There is no server and no reactive query library, so writes publish a revision
 * bump and views re-read. This keeps IndexedDB the single source of truth (0002 S2)
 * rather than letting a component hold a second copy that can drift.
 */

import Dexie from 'dexie'

let revision = 0
const listeners = new Set<() => void>()

/**
 * Announce that something has changed.
 *
 * **The notification is deferred until the transaction commits.**
 *
 * A bump inside a transaction tells the views to re-read *while the transaction is
 * still open*, and a re-read issued in that window joins the transaction — so the
 * view sees rows the transaction has not committed yet, and, worse, the read touches
 * whatever stores the view happens to use.
 *
 * A view that reads a store the transaction did not declare makes the transaction
 * fail outright ("an object store did not exist"), and the write is rolled back after
 * the interface has already shown it. That is not hypothetical: creating a client
 * bumps the revision from inside its transaction, the settings page re-reads the
 * `settings` and `contractPeriods` stores, and the client vanishes.
 *
 * So the notification waits for the transaction to settle. Committed or rolled back,
 * the data has stopped changing, and that is the moment the views should hear about
 * it — never before.
 */
export function bumpRevision(): void {
  const transaction = Dexie.currentTransaction
  if (transaction !== null && transaction !== undefined) {
    const notify = () => {
      revision += 1
      for (const listener of listeners) listener()
    }
    // `complete` fires on a commit and `abort` on a rollback. Whichever happens, the
    // data has stopped changing, and that is the moment the views should hear about it.
    //
    // `ignoreTransaction` runs the notification outside the transaction's context, so
    // the reads it provokes are ordinary reads rather than ones that join a
    // transaction that has already finished.
    transaction.on('complete', () => Dexie.ignoreTransaction(notify))
    transaction.on('abort', () => Dexie.ignoreTransaction(notify))
    return
  }

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
