import { useEffect, useRef, useState } from 'react'
import { DownloadIcon, MenuIcon, RestoreIcon, SettingsIcon } from '../../app/Icons'
import { BackupFileInput, BackupStatus } from '../backup/BackupParts'
import { useBackup } from '../backup/useBackup'

/**
 * The header menu (items 18 and 26).
 *
 * Item 18 put settings and backup here; item 26 then reduced it to "just the 3 buttons
 * which should be arranged vertically", with none of the surrounding text; item 29 put the
 * words back beside the icons.
 *
 * Read together, those three say something narrower than "no text": drop the explanatory
 * paragraphs, keep the three actions stacked, and keep each action named. An icon alone
 * makes the user guess, and writing out versus reading in is exactly the distinction they
 * must not have to infer from a shape.
 *
 * The labels are one word each, lower case — "download", "import" — rather than the full
 * "Download backup" / "Restore from file". The long forms live on the settings panel, where
 * there is room to finish the sentence; here they crowd three buttons into a strip that is
 * only ever three buttons wide.
 *
 * The labels are visible, so no `aria-label` is added: a control whose visible text and
 * accessible name differ is announced twice and confuses voice-control users. The name is
 * the word on the button.
 */

export interface HeaderMenuProps {
  /** Where "Settings" goes. Item 15 makes the title the home link instead. */
  settingsHref: string
}

export function HeaderMenu({ settingsHref }: HeaderMenuProps) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const backup = useBackup()
  const fileInput = useRef<HTMLInputElement>(null)
  const working = backup.state.kind === 'working'

  // Close on Escape and return focus to the button that opened it, so keyboard users are
  // not dropped at the top of the document.
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    // Close on a click elsewhere. The toggle itself is inside this container, so its own
    // click never reaches the outside handler and cannot double-fire with the toggle.
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
            className="header-menu-item"
            href={settingsHref}
            onClick={() => setOpen(false)}
            data-testid="header-menu-settings"
          >
            <SettingsIcon />
            <span>Settings</span>
          </a>

          <button
            type="button"
            className="header-menu-item"
            onClick={backup.export}
            disabled={working}
            data-testid="header-menu-download"
          >
            <DownloadIcon />
            <span>download</span>
          </button>

          <button
            type="button"
            className="header-menu-item"
            onClick={backup.chooseFile}
            disabled={working}
            data-testid="header-menu-restore"
          >
            <RestoreIcon />
            <span>import</span>
          </button>

          <BackupFileInput input={fileInput} onChange={backup.onFileChange} />

          {/*
            The one piece of text left, and only once something has happened: an action that
            quietly replaced everything in the browser with no confirmation would be the
            worst outcome in the app, so the result is always stated — here or on settings.
          */}
          <BackupStatus state={backup.state} />
        </div>
      )}
    </div>
  )
}
