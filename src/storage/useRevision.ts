import { useSyncExternalStore } from 'react'
import { getRevision, subscribe } from './events'

/**
 * Re-render when anything writes to the database.
 *
 * There is no reactive query layer, so writes publish a bump and views re-read
 * (`events.ts`). Six hooks were each spelling that subscription out; this is the same
 * call, named.
 *
 * The value is deliberately opaque. What a component wants is "something changed", and
 * returning the counter invites two mistakes: comparing it to a remembered value, which
 * is a stale-closure bug waiting to happen, and using it as a cache key, which turns
 * every unrelated write into a re-read. Both are worse than re-reading.
 */
export function useRevision(): number {
  return useSyncExternalStore(subscribe, getRevision, getRevision)
}
