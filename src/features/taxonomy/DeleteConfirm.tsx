import { useEffect, useRef, useState } from 'react'

/**
 * Destructive confirmation (0005 X1–X4, T3).
 *
 * The spec is specific about what has to be on screen before anyone commits: the number
 * of affected entries and the billable hours involved (X1), and a plain statement that
 * the entries are kept and only lose their project (X2). So the impact is loaded and
 * rendered before the confirm button is offered — a confirm that appears first and fills
 * in afterwards is a confirm the user has already passed.
 *
 * A second, stronger step when billable entries are involved (X3). "Should", so this is
 * the one place the app deliberately adds friction: billable hours are the data a user
 * would be least able to reconstruct, and deleting a project can orphan them from every
 * future report at once.
 *
 * Rendered inline in the page flow rather than as a modal. A modal without focus
 * trapping makes the page behind it still reachable, which is worse than a clearly
 * bounded region; this takes focus when it appears so keyboard users land on the decision.
 */

export interface DeleteConfirmProps {
  /** The record's name, quoted in the prompt. */
  name: string
  /** "project", "client" or "tag". */
  entity: string
  /** Already-formatted impact lines: counts and hours. */
  impact: readonly string[]
  /** What survives the deletion, stated plainly (0005 X2). */
  keeps: string
  /** Requires the second step (0005 X3). */
  requireStrongConfirm: boolean
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}

export function DeleteConfirm({
  name,
  entity,
  impact,
  keeps,
  requireStrongConfirm,
  onConfirm,
  onCancel,
  busy = false,
}: DeleteConfirmProps) {
  const [step, setStep] = useState<'summary' | 'strong'>('summary')
  const region = useRef<HTMLDivElement>(null)

  // Focus the region so the decision is reached without hunting for it, and so Escape
  // has somewhere sensible to cancel from.
  useEffect(() => {
    region.current?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const heading = `Delete ${entity} "${name}"?`

  return (
    <div
      className="delete-confirm"
      role="group"
      aria-labelledby="delete-confirm-heading"
      tabIndex={-1}
      ref={region}
      data-testid={`delete-confirm-${entity}`}
    >
      <h4 id="delete-confirm-heading">{step === 'strong' ? 'Confirm again' : heading}</h4>

      {step === 'strong' ? (
        <>
          <p>
            {entity === 'project'
              ? 'The billable hours above will no longer be attributable to this project.'
              : 'This affects billable work recorded under this ' + entity + '.'}{' '}
            You can undo this from the bar that appears, but only for a short while.
          </p>
          <div className="button-row">
            <button
              type="button"
              className="button button-danger"
              onClick={onConfirm}
              disabled={busy}
              data-testid="delete-confirm-strong"
            >
              {`Yes, delete "${name}"`}
            </button>
            <button type="button" className="button" onClick={() => setStep('summary')}>
              Go back
            </button>
          </div>
        </>
      ) : (
        <>
          {impact.length > 0 && (
            <ul data-testid="delete-impact">
              {impact.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <p>{keeps}</p>
          <div className="button-row">
            <button
              type="button"
              className="button button-danger"
              onClick={() => (requireStrongConfirm ? setStep('strong') : onConfirm())}
              disabled={busy}
              data-testid="delete-confirm-accept"
            >
              {requireStrongConfirm ? 'Continue' : heading}
            </button>
            <button type="button" className="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}
