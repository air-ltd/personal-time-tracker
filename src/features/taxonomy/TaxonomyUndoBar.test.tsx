import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectUndoBar } from './TaxonomyUndoBar'

/**
 * The taxonomy undo window (0005 X5).
 *
 * Restoring a taxonomy deletion puts the record *and* the references the delete cleared,
 * so an accidental timeout firing the restore is worse here than for an entry: the
 * surviving detail is fine either way, but re-linking entries behind the user's back is
 * not. These tests pin the two outcomes apart.
 */

afterEach(() => {
  vi.useRealTimers()
})

const PENDING = { label: 'project "Acme"', detail: '3 entries are now uncategorised' }

describe('taxonomy undo bar', () => {
  it('names what was deleted and what it did to the entries', () => {
    render(<ProjectUndoBar pending={PENDING} onUndo={vi.fn()} onDismiss={vi.fn()} />)

    expect(screen.getByTestId('undo-bar')).toHaveTextContent(
      'Deleted project "Acme" — 3 entries are now uncategorised',
    )
  })

  it('omits the consequence when it had none', () => {
    render(
      <ProjectUndoBar
        pending={{ ...PENDING, detail: null }}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    expect(screen.getByTestId('undo-bar')).not.toHaveTextContent('—')
  })

  it('restores on Undo', async () => {
    const onUndo = vi.fn()
    const user = userEvent.setup()
    render(<ProjectUndoBar pending={PENDING} onUndo={onUndo} onDismiss={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Undo' }))

    expect(onUndo).toHaveBeenCalledOnce()
  })

  it('leaves the deletion in place when the window closes', () => {
    vi.useFakeTimers()
    const onUndo = vi.fn()
    const onDismiss = vi.fn()
    render(<ProjectUndoBar pending={PENDING} onUndo={onUndo} onDismiss={onDismiss} />)

    act(() => {
      vi.advanceTimersByTime(10_000)
    })

    expect(onDismiss).toHaveBeenCalledOnce()
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('does not close early', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<ProjectUndoBar pending={PENDING} onUndo={vi.fn()} onDismiss={onDismiss} />)

    act(() => {
      vi.advanceTimersByTime(9_000)
    })

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('does not let a re-render push the deadline out', () => {
    // Regression risk in the shape of the fix: making `onDismiss` stable is what stops the
    // timer being re-armed, so a caller that hands over a fresh function each render would
    // silently give the bar an unlimited window.
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const { rerender } = render(
      <ProjectUndoBar pending={PENDING} onUndo={vi.fn()} onDismiss={onDismiss} />,
    )

    for (let i = 0; i < 5; i += 1) {
      act(() => {
        vi.advanceTimersByTime(1_000)
      })
      rerender(<ProjectUndoBar pending={PENDING} onUndo={vi.fn()} onDismiss={onDismiss} />)
    }

    expect(onDismiss).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
