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

/** A chevron, for the collapsible cards (items 25, 26). */
export function ChevronIcon({ size = 16, weight }: IconProps) {
  return (
    <Svg size={size} weight={weight}>
      <path d="m7 10 5 5 5-5" />
    </Svg>
  )
}
