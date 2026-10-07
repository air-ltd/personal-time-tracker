import { PlusIcon } from './Icons'

/**
 * A section heading with its add button on the same line.
 *
 * One component because the timer card and the taxonomy sections each had a copy, and the
 * copies had drifted into two names for the same flex rule and one button class named for
 * whichever card happened to be written first — `timer-add-client` was styling the "New
 * project" button too, so the stylesheet read as though the timer owned the add buttons of
 * the whole settings page.
 *
 * `testId` is a parameter rather than derived, because the two are genuinely different
 * affordances: the timer's opens a client form, the taxonomy ones open a project or client
 * form, and a test that looked for `new-client` should not find the timer's.
 */
export function AddToHeading({
  headingId,
  heading,
  addLabel,
  addTitle,
  onAdd,
  className,
  testId,
  headingLevel = 2,
}: {
  /** Ties the heading to the section that labels it. */
  headingId: string
  heading: string
  /** The button's accessible name. */
  addLabel: string
  /**
   * The tooltip, where it should say more than the name does.
   *
   * Optional because most of these buttons are icon-only next to a heading that already
   * names the thing ("Clients and projects" beside "+ Client"), where repeating the name
   * adds nothing. Where the button stands alone — the timer card's "+", which is the only
   * control in its header — a sentence is worth having.
   */
  addTitle?: string | undefined
  onAdd: () => void
  className: string
  testId: string
  /** Taxonomy sections sit inside a panel, so they drop to `h3`. */
  headingLevel?: 2 | 3
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <div className={className}>
      <Heading id={headingId}>{heading}</Heading>
      {/*
        "New client", not "Add client": the form's own submit button is called "Add
        client", and while that form is open both are on screen with the same accessible
        name — so "Add client" matched two controls.
      */}
      <button
        type="button"
        className="button heading-add-button"
        onClick={onAdd}
        aria-label={addLabel}
        // Falls back to the name, so no button is left without a tooltip.
        title={addTitle ?? addLabel}
        data-testid={testId}
      >
        <PlusIcon />
      </button>
    </div>
  )
}
