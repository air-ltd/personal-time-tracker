import { localDayBounds } from '../time/days'

/**
 * The heading shown above a day's entries.
 *
 * Wrapped in a `try/catch` that falls back to the raw key on purpose: a single corrupt
 * `start` must not throw during render and take down the whole list, hiding every other
 * entry with it. Showing the key is unhelpful but honest, and keeps the rest of the day
 * readable.
 *
 * Shared because the day list and the day summary each had an identical copy. That
 * defensive catch is the best argument for having one of them — it is the reason a
 * divergence here would be easy to miss.
 */
export function dayHeading(key: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(localDayBounds(key).start)
  } catch {
    return key
  }
}
