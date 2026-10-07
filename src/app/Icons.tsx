/**
 * Inline SVG icons (items 17, 20 and 23).
 *
 * Drawn here rather than fetched, and deliberately so: these are third-party illustrations
 * with their own licence and attribution terms, and hot-linking or copying them into the
 * repository brings those terms along. Hand-drawn paths carry no such obligation, scale
 * cleanly, inherit `currentColor` for both themes, and cost no extra request — which
 * matters because a failed request leaves a blank gap where a control should be.
 *
 * Every icon shares a 24×24 grid, a 2px stroke, and round caps and joins, so a row of them
 * reads as one set rather than as assorted clip art. They are geometrically centred on that
 * grid: the visible extent of each is roughly 20×20 within it, so swapping one for another
 * does not shift the text beside it.
 *
 * Every icon is `aria-hidden`. The control around it carries the name, so an icon that were
 * also announced would be read twice — and an icon-only button with no name is invisible to
 * a screen reader.
 */

interface IconProps {
  /** Rendered size in pixels. Defaults suit a line of button text. */
  size?: number | undefined
  /**
   * Stroke width, in grid units.
   *
   * Overridable because a 14px icon drawn with a 2px stroke reads as heavier than a 20px
   * one at the same size, which makes a row of mixed sizes look misaligned.
   */
  weight?: number | undefined
}

function Svg({
  size,
  weight = 2,
  children,
  label,
}: IconProps & { children: React.ReactNode; label?: string }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label === undefined ? true : undefined}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      focusable="false"
    >
      {children}
    </svg>
  )
}

/**
 * A cloud with an arrow going up into it — "Connect Dropbox" (item 17).
 *
 * The arrow is what distinguishes this from a plain cloud: the action is sending data out,
 * not merely storing it, and a bare cloud would read as "cloud storage" in the abstract.
 * Drawn as a closed outline with the arrow breaking through the top edge, so the two shapes
 * interlock rather than overlapping.
 */
export function CloudIcon({ size = 16, weight }: IconProps) {
  return (
    <Svg size={size} weight={weight}>
      {/* Cloud body: a wide arc for the top, tucked into the arrow's gap at the apex. */}
      <path d="M6.5 19a4.5 4.5 0 0 1-.42-8.98 6 6 0 0 1 11.6 1.28A3.85 3.85 0 0 1 17.5 19Z" />
      {/* Arrow: up into the cloud. */}
      <path d="M12 21v-7" />
      <path d="m9.2 16.4 2.8-2.8 2.8 2.8" />
    </Svg>
  )
}

/**
 * The header's Dropbox mark, carrying the sync state inside it (item 65).
 *
 * One cloud with the state drawn within it, rather than a bare cloud per state or a cloud
 * beside a separate badge: the header then says what the icon *is* at a glance — this is
 * sync — and the mark inside says how it is going. A tick, a bang and a clock all fit in
 * the cloud's belly; anything larger would not survive 16px.
 *
 * The cloud is redrawn here rather than reused from `CloudIcon`, whose arrow breaks through
 * the top edge and leaves no room inside for a state. `state` picks the mark; anything else
 * falls back to the check, so a new state cannot render as a blank cloud by accident.
 */
export function CloudStateIcon({
  size = 16,
  weight = 2,
  state,
}: IconProps & {
  /** `synced`, `failed`, `pending`, `syncing`, `offline` or `setup`. */
  state: 'synced' | 'failed' | 'pending' | 'syncing' | 'offline' | 'setup'
}) {
  return (
    <Svg size={size} weight={weight}>
      {/*
        The cloud, closed at the bottom and open enough at the top to read as a cloud at
        16px. Kept low so the mark inside has room without the two touching.
      */}
      <path d="M6.6 18.5a4.2 4.2 0 0 1-.4-8.37 5.7 5.7 0 0 1 11 .1 3.7 3.7 0 0 1-.2 8.27Z" />
      {state === 'synced' && (
        // A tick, the one mark that means "this finished and it worked".
        <path d="m9.4 13.6 2 2 3.4-3.9" />
      )}
      {state === 'failed' && (
        // A bang. Its stem stops short of the dot, so the two do not merge into a blob.
        <>
          <path d="M12 10.4v3.1" />
          <path d="M12 15.6h.01" strokeWidth={weight + 0.6} />
        </>
      )}
      {state === 'pending' && (
        // A clock: work is waiting to go out.
        <>
          <path d="M12 10v2.3l1.6 1" />
          <circle cx="12" cy="12.6" r="3.5" />
        </>
      )}
      {state === 'syncing' && (
        // Two arrows chasing each other, so the state reads as movement rather than a wait.
        <>
          <path d="M9.3 11.6a2.8 2.8 0 0 1 4.9-.5" />
          <path d="M14.2 9.4v2.2h-2.2" />
          <path d="M14.7 13.6a2.8 2.8 0 0 1-4.9.5" />
          <path d="M9.8 15.8v-2.2H12" />
        </>
      )}
      {state === 'offline' && (
        // A slash: the connection is not there.
        <path d="m9.6 10.4 4.8 4.8M14.4 10.4l-4.8 4.8" />
      )}
      {state === 'setup' && (
        // A plus: there is no app key yet, and this is the "add one" affordance's twin.
        <path d="M12 10.7v3.8M10.1 12.6h3.8" />
      )}
    </Svg>
  )
}

/**
 * A pencil on its side — the per-entry edit control (item 20).
 *
 * Drawn with the tip as a filled triangle rather than an outlined one: at 16px an outlined
 * nib collapses into the stroke it shares with the barrel and reads as a blob.
 */
export function EditIcon({ size = 16, weight }: IconProps) {
  return (
    <Svg size={size} weight={weight}>
      <path d="M4 20.5h4.2L19 9.7a2.4 2.4 0 0 0 0-3.4l-1.3-1.3a2.4 2.4 0 0 0-3.4 0L3.5 15.8Z" />
      <path d="m13.4 6.2 4.4 4.4" />
      {/* The nib, filled so it survives being this small. */}
      <path d="M4 20.5 3.5 15.8 7 16.6Z" fill="currentColor" stroke="none" />
    </Svg>
  )
}

/** Three lines — the header menu (item 18). */
export function MenuIcon({ size = 18, weight }: IconProps) {
  return (
    <Svg size={size} weight={weight}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  )
}

/** An arrow down into a tray — "Download backup" (item 18). */
export function DownloadIcon({ size = 16, weight }: IconProps) {
  return (
    <Svg size={size} weight={weight}>
      <path d="M12 4v10" />
      <path d="m8.2 10.2 3.8 3.8 3.8-3.8" />
      <path d="M4.5 19.5h15" />
    </Svg>
  )
}

/** An arrow up out of a tray — "Restore from file" (item 18). */
export function RestoreIcon({ size = 16, weight }: IconProps) {
  return (
    <Svg size={size} weight={weight}>
      <path d="M12 14.5V4" />
      <path d="m8.2 8.3 3.8-3.8 3.8 3.8" />
      <path d="M4.5 19.5h15" />
    </Svg>
  )
}

/**
 * A plus — "New client" (item 16).
 *
 * Drawn rather than a text "+", which varies between platforms and sits at an inconsistent
 * optical centre. Kept here with the other icons so the whole set shares one grid.
 */
export function PlusIcon({ size = 16, weight = 2.4 }: IconProps) {
  return (
    <Svg size={size} weight={weight}>
      <path d="M12 5.5v13M5.5 12h13" />
    </Svg>
  )
}

/**
 * A cog — "Settings" (item 26).
 *
 * The teeth are drawn as a ring with eight short radial strokes rather than as a scalloped
 * outline: a scalloped path needs more points than survive at 18px, where the gaps between
 * teeth close up and the shape reads as a blob.
 */
export function SettingsIcon({ size = 16, weight }: IconProps) {
  return (
    <Svg size={size} weight={weight}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8" />
      <path d="m18.5 5.5-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" />
    </Svg>
  )
}

/**
 * A circled "i" — "About".
 *
 * The universally recognised "what is this" mark, chosen over a book or a document because
 * those read as *documentation* — which would promise something to read rather than a page
 * describing the app and what has changed in it.
 *
 * Drawn as a circle plus two strokes rather than as a glyph, so it matches the cog and the
 * menu mark in weight and optical size. The stem stops short of the dot by a full stroke
 * width: joining them makes the two merge into an exclamation mark at 16px, which says
 * warning rather than information.
 */
export function InfoIcon({ size = 16, weight = 2 }: IconProps) {
  return (
    <Svg size={size} weight={weight}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      {/* Filled rather than stroked: a 2px round cap at this radius reads as a smudge, and
          the dot has to survive being 2px across. */}
      <path d="M12 7.6h.01" strokeWidth={weight + 0.6} />
    </Svg>
  )
}

/** A chevron, for the collapsible cards (items 25, 26). */
export function ChevronIcon({ size = 16, weight }: IconProps) {
  return (
    <Svg size={size} weight={weight}>
      <path d="m7 10 5 5 5-5" />
    </Svg>
  )
}

/**
 * A play triangle, for starting a timer (item 63).
 *
 * Filled, and drawn as its own filled shape rather than a stroked triangle: the shared `Svg`
 * wrapper is `fill="none"` and strokes, which turns a play mark into an outline that reads
 * as hollow next to a solid pause bar. A filled triangle is the one mark that cannot be
 * mistaken for anything else, so it overrides the wrapper's `fill`.
 */
export function PlayIcon({ size = 16, weight = 2 }: IconProps) {
  return (
    <Svg size={size} weight={weight}>
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />
    </Svg>
  )
}

/**
 * A filled square, for stopping (item 63).
 *
 * A square rather than two bars. A pause mark says *hold this here*, which is not what
 * Stop does to a timer: stopping writes the entry and ends it. The square beside a play
 * triangle is the stop/record convention people already read without thinking, and it sits
 * against the triangle without the bars' ambiguity about whether anything is still running.
 *
 * Filled, overriding the wrapper's `fill="none"`, for the same reason the triangle is.
 */
export function StopIcon({ size = 16, weight = 2 }: IconProps) {
  return (
    <Svg size={size} weight={weight}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="1" fill="currentColor" stroke="none" />
    </Svg>
  )
}

/**
 * A wastebasket, for discarding a timer (item 63).
 *
 * Drawn rather than borrowed, for the reason item 17 records for the cloud: a specific
 * third-party icon set would carry its own licence and attribution terms, and a guess at
 * what a bin should look like is worse than something plainly ours.
 *
 * Two strokes for the rim and three for the body, so it holds together at 16px — a bin drawn
 * with more detail than that reads as a smudge at this size. Inherits `currentColor`, so
 * the red comes from the button it sits in rather than being baked into the mark.
 */
export function TrashIcon({ size = 16, weight = 1.9 }: IconProps) {
  return (
    <Svg size={size} weight={weight}>
      {/* The lid, and its handle. */}
      <path d="M4.5 6.5h15" />
      <path d="M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5" />
      {/* The body, tapering to the base. */}
      <path d="M6.5 6.5 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.5" />
      {/* Two ribs, which is what makes it read as a bin rather than a bucket. */}
      <path d="M10.5 10v7M13.5 10v7" />
    </Svg>
  )
}
