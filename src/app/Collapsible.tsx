import { useState, type ElementType, type ReactNode } from 'react'
import { ChevronIcon } from './Icons'

/**
 * A heading that is also the control for the content beneath it.
 *
 * **The button is inside the heading, not instead of it.** A disclosure has to be operable,
 * which means a button; but the heading is what puts this section in the page outline and
 * what `aria-labelledby` on the surrounding `<section>` points at. Putting the button inside
 * the heading keeps both — a bare button styled like a heading looks the same but disappears
 * from the outline, so a screen reader user cannot jump between sections of the page.
 *
 * **Closed by default.** Both callers wanted the same thing: the content is reference
 * material a reader arrives at deliberately, and a page that opened with it expanded put the
 * thing they came for below it. Openness is therefore per-component state rather than a
 * page-wide setting, so expanding one section does not expand the others.
 */
export interface CollapsibleProps {
  /** Heading level, so the section keeps its place in the page outline. */
  level: 2 | 3 | 4
  /** The heading text, and the control's accessible name. */
  title: string
  children: ReactNode
  /**
   * Stable id, used to derive the heading's and the body's ids.
   *
   * Required rather than generated: the body id is what `aria-controls` names, and a value
   * derived from the component's position in the tree — or from a counter — changes when
   * anything above it is added, which would leave the control pointing at nothing.
   */
  id: string
  /** Open on first render. Ignored when `open` is given. Defaults to closed. */
  defaultOpen?: boolean
  /**
   * Controlled open state, for when something outside owns it.
   *
   * The changelog uses this: its versions share one expansion — a reader who opened 0.2.0 did
   * not ask for 0.1.0 as well — so the set of open versions lives in the caller and each
   * section is told whether *it* is open. Without it, each version would own its own state
   * and there would be no way to coordinate them.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Class on the wrapping element, for the section's own styling. */
  className?: string
  /**
   * Class on the body specifically, when it needs its own styling.
   *
   * Separate from `className` because the two are different things: the wrapper is the
   * section's box, the body is the revealed content. The changelog indents and pads the body
   * while the wrapper carries the rule above it.
   */
  bodyClassName?: string
  /** Class on the button, for the disclosure line's styling. */
  toggleClassName?: string
}

export function Collapsible({
  level,
  title,
  children,
  id,
  defaultOpen = false,
  open,
  onOpenChange,
  className,
  bodyClassName,
  toggleClassName,
}: CollapsibleProps) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen)
  const isOpen = open ?? ownOpen
  const bodyId = `${id}-body`

  function toggle(): void {
    const next = !isOpen
    if (open === undefined) setOwnOpen(next)
    onOpenChange?.(next)
  }
  /*
   * The heading, chosen from the level.
   *
   * Typed as an `ElementType` rather than computed as a `h${level}` string: the template
   * literal types as `'h2' | 'h3' | 'h4'`, which TypeScript will not accept as a JSX tag.
   */
  const Heading: ElementType = `h${level}`

  return (
    <div className={className}>
      <Heading id={id} className="collapsible-heading">
        {/*
          `aria-expanded` is what carries the state for anything that cannot see the
          disclosure triangle, and `aria-controls` ties the button to the region it reveals.
          Both are on the button because the button is the control.
        */}
        <button
          type="button"
          className={toggleClassName ?? 'collapsible-toggle'}
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={toggle}
        >
          {/* Decorative: the state is on the button, and the shared icon wrapper hides
              unlabelled SVGs from the accessibility tree, so it is not announced twice. */}
          <ChevronIcon />
          <span>{title}</span>
        </button>
      </Heading>
      {/*
        `hidden`, rather than a height or an opacity. A closed section's content is not on
        the page at all, so it must also be unreachable by screen reader and by find-in-page;
        collapsing with `max-height: 0` leaves all of it focusable and findable.
      */}
      <div id={bodyId} className={bodyClassName} hidden={!isOpen}>
        {children}
      </div>
    </div>
  )
}
