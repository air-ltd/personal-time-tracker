/**
 * How long an undo offer stays up (0003 D3).
 *
 * One constant because there were two — one in the entry undo bar and one in the taxonomy
 * undo bar — each private, each claiming the same window in its own comment. Two numbers
 * for one rule is how they drift, and the drift would not be visible from either file.
 */
export const AUTO_HIDE_MS = 10_000
