import { useEffect, useRef, useState } from 'react'
import { BackupPanel } from '../backup/BackupPanel'
import { MenuIcon } from '../../app/Icons'

/**
 * The header menu (item 18 of `SPECS/todo.md`).
 *
 * "Backup & recovery actions should be on a hamburger menu with settings."
 *
 * Backup and restore were a full panel on the home screen, between the entries and the
 * bottom of the page, for two buttons used rarely. Moving them behind the menu puts
 * everything you configure in one place and gives the entries the room back.
 *
 * A disclosure button rather than a `<details>` element: this needs to close on Escape and
 * on a click outside, and it needs to report its open state to the rest of the header so
 * the title link and the sync indicator can step aside while it is over them.
 *
 * The panel is only mounted while open. Backup does work on mount — it reads the stored
 * snapshot — so keeping it mounted would mean doing that work on every page load to
 * display something nobody asked for.
 */

export interface HeaderMenuProps {
  /** Where "Settings" goes. Item 15 makes the title the home link instead. */
  settingsHref: string
  onNavigate?: () => void
}

export function HeaderMenu({ settingsHref, onNavigate }: HeaderMenuProps) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  // Close on Escape and return focus to the button that opened it, so keyboard users are
  // not dropped at the top of the document.
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    // Close on a click elsewhere, but not on the click that landed on the toggle itself —
    // that is the browser's own toggle behaviour and handling both double-fires.
    function onPointerDown(event: PointerEvent): void {
      if (container.current?.contains(event.target as Node) !== true) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <div className="header-menu" ref={container}>
      <button
        ref={button}
        type="button"
        className="button header-menu-toggle"
        aria-expanded={open}
        aria-controls="header-menu-panel"
        onClick={() => setOpen((value) => !value)}
        data-testid="header-menu-toggle"
      >
        <MenuIcon />
        <span className="visually-hidden">Menu</span>
      </button>

      {open && (
        <div className="header-menu-panel" id="header-menu-panel">
          <a
            className="button"
            href={settingsHref}
            onClick={onNavigate}
            data-testid="header-menu-settings"
          >
            Settings
          </a>

          <BackupPanel onNavigate={onNavigate} />
        </div>
      )}
    </div>
  )
}
