/**
 * Name rules (0005 P2, T2, 0003).
 *
 * Uniqueness is enforced here rather than by a database index because IndexedDB indexes
 * are byte-exact: they cannot express "unique after trimming, case-insensitively", which
 * is the rule. Two devices creating "Acme" and "acme" offline would otherwise both
 * succeed and merge into two projects that look identical in a report.
 */

/**
 * Comparison key for a name.
 *
 * Trimmed and lowercased, then normalised to NFC — deliberately, because NFC and NFD
 * forms of the same accented character are different byte sequences and would compare
 * unequal here. "café" typed on a Mac and "café" typed on Linux could otherwise both be
 * created, and both would survive to a report as two projects that look identical.
 * Normalising also means a name round-tripped through a backup — where the form can
 * differ from the one it was typed in — still compares equal to itself, so a restore on
 * a different device cannot fail a uniqueness check the original creation passed.
 *
 * Applied last so the lowercasing is the final step before comparison: normalisation can
 * in principle reintroduce a character that lowercasing would have folded differently.
 */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().normalize('NFC')
}

export const NAME_LIMITS = {
  project: { min: 1, max: 80 },
  client: { min: 1, max: 80 },
  tag: { min: 1, max: 40 },
} as const

export type NameKind = keyof typeof NAME_LIMITS

export type NameProblem =
  | { kind: 'empty' }
  | { kind: 'too-long'; limit: number }
  | { kind: 'duplicate'; existingId: string; existingName: string }

/** Check a name in isolation, before consulting what already exists. */
export function validateName(kind: NameKind, name: string): NameProblem | null {
  const trimmed = name.trim()
  const limits = NAME_LIMITS[kind]
  if (trimmed.length < limits.min) return { kind: 'empty' }
  if (trimmed.length > limits.max) return { kind: 'too-long', limit: limits.max }
  return null
}

export interface ExistingName {
  id: string
  name: string
  archived: boolean
}

/**
 * Find a name conflict among existing records.
 *
 * Archived records are excluded for projects (0005 P2) so a name freed by archiving can
 * be reused; a client name is unique regardless of archived state (0003). The exclusion
 * is a parameter rather than inferred from the record, because the two rules differ.
 */
export function findNameConflict(
  kind: NameKind,
  name: string,
  existing: readonly ExistingName[],
  options: { ignoreArchived: boolean },
): NameProblem | null {
  const shape = validateName(kind, name)
  if (shape) return shape

  const key = nameKey(name)
  for (const candidate of existing) {
    if (options.ignoreArchived && candidate.archived) continue
    if (nameKey(candidate.name) === key) {
      return {
        kind: 'duplicate',
        existingId: candidate.id,
        existingName: candidate.name,
      }
    }
  }
  return null
}

/**
 * The one field a name lookup needs.
 *
 * Narrower than `ExistingName` on purpose. `ExistingName` carries `archived`, which
 * `findNameConflict` reasons about and which a `Tag` has no concept of — so constraining
 * this to `ExistingName` made it unusable for tags, and the one caller that needed Unicode
 * normalisation wrote its own comparison and lost the `.normalize('NFC')`. This function
 * reads nothing but `name`, so it says so.
 */
export interface NamedRecord {
  name: string
}

/**
 * Find an existing record matching a name, ignoring case, surrounding space and Unicode
 * normalisation form.
 *
 * This is what inline tag creation depends on: typing `Research` when `research` exists
 * must select the existing tag rather than create a duplicate (0005 T2) — and the same
 * holds for a name that arrives decomposed from a backup or from a different platform's
 * keyboard. Comparison goes through `nameKey`, so there is one definition of "the same
 * name" in the codebase rather than one per call site.
 */
export function findByName<T extends NamedRecord>(
  name: string,
  existing: readonly T[],
): T | undefined {
  const key = nameKey(name)
  return existing.find((candidate) => nameKey(candidate.name) === key)
}
