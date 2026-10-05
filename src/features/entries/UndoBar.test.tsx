import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UndoBar } from './UndoBar'

/**
 * The undo window (0003 D3).
 *
 * The timer is the whole behaviour under test here, so these are direct renders rather
 * than driven through the app: no IndexedDB, nothing else to settle.
 */

afterEach(() => {
  vi.useRealTimers()
})

const PENDING = { id: 'entry-1', label: 'an entry', durationMs: 1_800_000 }

describe('undo bar', () => {
  it('names what was deleted and how long it was', () => {
    render(<UndoBar pending={PENDING} onUndo={vi.fn()} onDismiss={vi.fn()} />)

    expect(screen.getByTestId('undo-bar')).toHaveTextContent('Deleted an entry (30m)')
  })

  it('omits the duration when there was no running time', () => {
    render(
      <UndoBar
        pending={{ ...PENDING, durationMs: null }}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    expect(screen.getByTestId('undo-bar')).not.toHaveTextContent('(')
  })

  it('restores on Undo', async () => {
    const onUndo = vi.fn()
    const user = userEvent.setup()
    render(<UndoBar pending={PENDING} onUndo={onUndo} onDismiss={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Undo' }))

    expect(onUndo).toHaveBeenCalledOnce()
  })

  it('leaves the deletion in place when the window closes', () => {
    // Regression: the timeout used to call the undo callback, so deleting an entry and
    // walking away for ten seconds brought it back with no deliberate act from the user.
    vi.useFakeTimers()
    const onUndo = vi.fn()
    const onDismiss = vi.fn()
    render(<UndoBar pending={PENDING} onUndo={onUndo} onDismiss={onDismiss} />)

    act(() => {
      vi.advanceTimersByTime(10_000)
    })

    expect(onDismiss).toHaveBeenCalledOnce()
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('does not close early', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<UndoBar pending={PENDING} onUndo={vi.fn()} onDismiss={onDismiss} />)

    act(() => {
      vi.advanceTimersByTime(9_000)
    })

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('starts a fresh window for the next deletion rather than inheriting the old one', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const { rerender } = render(
      <UndoBar pending={PENDING} onUndo={vi.fn()} onDismiss={onDismiss} />,
    )

    act(() => {
      vi.advanceTimersByTime(9_000)
    })
    rerender(
      <UndoBar
        pending={{ ...PENDING, id: 'entry-2' }}
        onUndo={vi.fn()}
        onDismiss={onDismiss}
      />,
    )
    act(() => {
      vi.advanceTimersByTime(1_500)
    })

    // The superseded window must not fire, and the new one must still have time left.
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
