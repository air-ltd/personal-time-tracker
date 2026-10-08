import { useCallback, useState } from 'react'
import { DeleteConfirm } from './DeleteConfirm'
import { ProjectUndoBar, type TaxonomyUndo } from './TaxonomyUndoBar'
import {
  deleteTag,
  tagEntryCount,
  undoDeleteTag,
  type DeleteTagReceipt,
} from '../../storage/taxonomyRepo'
import type { Tag } from '../../domain/taxonomy/types'

/** Undo needs the receipt, but the bar is told a sentence rather than being handed the
 * union to narrow — so the receipt is held here and the bar stays a presentation concern.
 */
type UndoReceipt = { kind: 'tag'; receipt: DeleteTagReceipt }

function counted(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * Deleting a tag, and undoing it.
 *
 * **Tags only.** Projects and clients used to be here too, with impact counts and a second
 * confirmation for billable work, and they no longer are: archiving replaces deleting for
 * both (0005 X1). Nothing about archiving needs this hook — it sets a flag, moves no entry,
 * and reverses with the restore already required by X2 and A5.
 *
 * Tags are the exception because deleting one is a *move*, not a hide. It strips the tag
 * from every entry carrying it, which is why the entry count is loaded before the prompt
 * rather than after it: there is no way to warn honestly once it has happened.
 */
export function useTagDeletes({
  now,
  report,
  clearError,
}: {
  now: Date
  /** How the component reports a failure to the user. */
  report: (problem: unknown) => void
  /** Clears whatever the shared error banner is showing, before a new prompt opens. */
  clearError: () => void
}): {
  onDelete: (record: Tag) => void
  confirmation: React.ReactNode
  undoBar: React.ReactNode
} {
  const [undo, setUndo] = useState<TaxonomyUndo | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{
    id: string
    name: string
    /** How many entries carry it — the number the deletion would strip. */
    entryCount: number
  } | null>(null)
  const [undoReceipt, setUndoReceipt] = useState<UndoReceipt | null>(null)
  /**
   * A delete is in flight.
   *
   * The confirmation's own button is the only thing between one press and two, and without
   * this it was never disabled — so two clicks in one render pass both ran the delete. The
   * second found the tag already tombstoned and reported nothing. `DeleteConfirm` takes a
   * `busy` prop that no caller supplied.
   */
  const [deleting, setDeleting] = useState(false)

  const askToDelete = useCallback(
    async (record: Tag) => {
      try {
        const entryCount = await tagEntryCount(record.id)
        setPendingDelete({ id: record.id, name: record.name, entryCount })
      } catch (problem) {
        report(problem)
      }
    },
    [report],
  )

  /** What a row's Delete button calls: clears any stale error, then opens the prompt. */
  const onDelete = useCallback(
    (record: Tag) => {
      clearError()
      void askToDelete(record)
    },
    [clearError, askToDelete],
  )

  async function runDelete() {
    if (!pendingDelete || deleting) return
    const { id, name } = pendingDelete
    setPendingDelete(null)
    setDeleting(true)
    try {
      const receipt = await deleteTag(id, now)
      if (receipt) {
        const count = receipt.untaggedEntryIds.length
        setUndoReceipt({ kind: 'tag', receipt })
        setUndo({
          label: `tag "${name}"`,
          detail:
            count > 0
              ? `${count} ${count === 1 ? 'entry lost' : 'entries lost'} the tag`
              : null,
        })
      }
    } catch (problem) {
      report(problem)
    } finally {
      setDeleting(false)
    }
  }

  // Stable, so the undo bar's auto-hide timer is armed once per deletion.
  const dismissUndo = useCallback(() => {
    setUndo(null)
    setUndoReceipt(null)
  }, [])

  async function runUndo() {
    if (!undoReceipt) return
    try {
      const outcome = await undoDeleteTag(undoReceipt.receipt, now)
      if (!outcome.ok) report(new Error(outcome.reason))
      setUndoReceipt(null)
      setUndo(null)
    } catch (problem) {
      report(problem)
    }
  }

  return {
    onDelete,
    confirmation:
      pendingDelete === null ? null : (
        <DeleteConfirm
          name={pendingDelete.name}
          entity="tag"
          impact={[
            `${counted(pendingDelete.entryCount, 'entry carries', 'entries carry')} this tag.`,
          ]}
          keeps="The entries are kept. They lose the tag."
          requireStrongConfirm={false}
          onConfirm={() => void runDelete()}
          onCancel={() => setPendingDelete(null)}
          busy={deleting}
        />
      ),
    undoBar:
      undo === null ? null : (
        <ProjectUndoBar pending={undo} onUndo={() => void runUndo()} onDismiss={dismissUndo} />
      ),
  }
}
