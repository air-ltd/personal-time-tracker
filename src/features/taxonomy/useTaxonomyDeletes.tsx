import { useCallback, useState } from 'react'
import { DeleteConfirm } from './DeleteConfirm'
import { ProjectUndoBar, type TaxonomyUndo } from './TaxonomyUndoBar'
import {
  clientDeleteImpact,
  deleteClient,
  projectDeleteImpact,
  tagEntryCount,
  undoDeleteClient,
  undoDeleteProject,
  undoDeleteTag,
  deleteProject,
  deleteTag,
  type DeleteClientReceipt,
  type DeleteProjectReceipt,
  type DeleteTagReceipt,
} from '../../storage/taxonomyRepo'
import { formatDuration } from '../../domain/time/duration'
import { MINUTE } from '../../domain/time/duration'
import type { Client, Project, Tag } from '../../domain/taxonomy/types'

/** What the confirmation is being asked about, and what the delete would cost. */
interface DeleteState {
  kind: 'project' | 'client' | 'tag'
  id: string
  name: string
  impact: string[]
  keeps: string
  requireStrongConfirm: boolean
}

/**
 * Undo needs the receipt, but the bar is told a sentence rather than being handed the
 * union to narrow — so the receipt is held here and the bar stays a presentation concern.
 */
type UndoReceipt =
  | { kind: 'project'; receipt: DeleteProjectReceipt }
  | { kind: 'client'; receipt: DeleteClientReceipt }
  | { kind: 'tag'; receipt: DeleteTagReceipt }

function counted(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * Deleting a taxonomy record, and undoing it (0005 X1–X6).
 *
 * Extracted because this was ~140 lines of state machine with no JSX in it, sitting in the
 * middle of a component that renders eight others. What it cost the reader was visible in
 * the file: the `undoReceipt` state was declared *after* the `runDelete` that sets it, and
 * the `busy` guard was added far from the button it protects. None of that is visible from
 * the component that has to use it.
 *
 * The impact counts are loaded before the prompt rather than after it, because whether a
 * second confirmation step is required depends on the billable count (X1/X3) — asking
 * afterwards would mean asking twice.
 */
export function useTaxonomyDeletes({
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
  askToDelete: (
    kind: 'project' | 'client' | 'tag',
    record: Project | Client | Tag,
  ) => Promise<void>
  onDelete: (kind: 'project' | 'client' | 'tag', record: Project | Client | Tag) => void
  confirmation: React.ReactNode
  undoBar: React.ReactNode
} {
  const [undo, setUndo] = useState<TaxonomyUndo | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DeleteState | null>(null)
  const [undoReceipt, setUndoReceipt] = useState<UndoReceipt | null>(null)
  /**
   * A delete is in flight.
   *
   * The confirmation's own button is the only thing between one press and two, and without
   * this it was never disabled — so two clicks in one render pass both ran the delete. The
   * second found the record already tombstoned and reported nothing, or deleted whatever
   * had taken its place. `DeleteConfirm` takes a `busy` prop that no caller supplied.
   */
  const [deleting, setDeleting] = useState(false)

  const askToDelete = useCallback(
    async (kind: 'project' | 'client' | 'tag', record: Project | Client | Tag) => {
      try {
        if (kind === 'project') {
          // X1/X3: the count and the billable hours are loaded before the prompt, and
          // billable hours are what decide whether a second step is required.
          const impact = await projectDeleteImpact(record.id)
          const billable =
            impact.billableEntryCount > 0
              ? formatDuration(impact.billableMinutes * MINUTE)
              : null
          setPendingDelete({
            kind,
            id: record.id,
            name: record.name,
            requireStrongConfirm: impact.billableEntryCount > 0,
            impact: [
              `${counted(impact.entryCount, 'entry uses', 'entries use')} this project.`,
              ...(impact.billableEntryCount > 0
                ? [
                    `${counted(impact.billableEntryCount, 'is', 'are')} billable — ${billable} of billable time.`,
                  ]
                : []),
            ],
            keeps: 'The entries are kept. They lose their project and appear as Uncategorised.',
          })
        } else if (kind === 'client') {
          // X4: projects survive; it is their client that goes.
          const impact = await clientDeleteImpact(record.id)
          setPendingDelete({
            kind,
            id: record.id,
            name: record.name,
            requireStrongConfirm: false,
            impact: [
              `${counted(impact.projectCount, 'project belongs', 'projects belong')} to this client.`,
            ],
            keeps:
              'The projects are kept. They stop belonging to a client, and their entries count as uncategorised by client.',
          })
        } else {
          const count = await tagEntryCount(record.id)
          setPendingDelete({
            kind,
            id: record.id,
            name: record.name,
            requireStrongConfirm: false,
            impact: [`${counted(count, 'entry carries', 'entries carry')} this tag.`],
            keeps: 'The entries are kept. They lose the tag.',
          })
        }
      } catch (problem) {
        report(problem)
      }
    },
    [report],
  )

  /** What a row's Delete button calls: clears any stale error, then opens the prompt. */
  const onDelete = useCallback(
    (kind: 'project' | 'client' | 'tag', record: Project | Client | Tag) => {
      clearError()
      void askToDelete(kind, record)
    },
    [clearError, askToDelete],
  )

  async function runDelete() {
    if (!pendingDelete || deleting) return
    const { kind, id, name } = pendingDelete
    setPendingDelete(null)
    setDeleting(true)
    try {
      if (kind === 'project') {
        const receipt = await deleteProject(id, now)
        if (receipt) {
          const count = receipt.orphanedEntryIds.length
          setUndoReceipt({ kind, receipt })
          setUndo({
            label: `${kind} "${name}"`,
            detail:
              count > 0
                ? `${count} ${count === 1 ? 'entry is' : 'entries are'} now uncategorised`
                : null,
          })
        }
      } else if (kind === 'client') {
        const receipt = await deleteClient(id, now)
        if (receipt) {
          const count = receipt.unlinkedProjectIds.length
          setUndoReceipt({ kind, receipt })
          setUndo({
            label: `${kind} "${name}"`,
            detail:
              count > 0
                ? `${count} ${count === 1 ? 'project has' : 'projects have'} no client`
                : null,
          })
        }
      } else {
        const receipt = await deleteTag(id, now)
        if (receipt) {
          const count = receipt.untaggedEntryIds.length
          setUndoReceipt({ kind, receipt })
          setUndo({
            label: `${kind} "${name}"`,
            detail:
              count > 0
                ? `${count} ${count === 1 ? 'entry lost' : 'entries lost'} the tag`
                : null,
          })
        }
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
      const outcome =
        undoReceipt.kind === 'project'
          ? await undoDeleteProject(undoReceipt.receipt, now)
          : undoReceipt.kind === 'client'
            ? await undoDeleteClient(undoReceipt.receipt, now)
            : await undoDeleteTag(undoReceipt.receipt, now)
      if (!outcome.ok) report(new Error(outcome.reason))
      setUndoReceipt(null)
      setUndo(null)
    } catch (problem) {
      report(problem)
    }
  }

  return {
    askToDelete,
    onDelete,
    confirmation:
      pendingDelete === null ? null : (
        <DeleteConfirm
          name={pendingDelete.name}
          entity={pendingDelete.kind}
          impact={pendingDelete.impact}
          keeps={pendingDelete.keeps}
          requireStrongConfirm={pendingDelete.requireStrongConfirm}
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
