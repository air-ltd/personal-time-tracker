import { act, render, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useUnloadWarning } from './useUnloadWarning'

describe('useUnloadWarning (0004 W1–W7)', () => {
  // W1 / W5: prompting when nothing is running trains the user to ignore it.
  it('registers nothing while idle', () => {
    const add = vi.spyOn(window, 'addEventListener')
    renderHook(() => useUnloadWarning({ active: false }))
    expect(add.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(0)
    add.mockRestore()
  })

  // W7's `pagehide` is deliberately not asserted here. It belongs to the sync scheduler,
  // which is where a pending cycle is flushed; this hook used to register a second
  // `pagehide` listener that forwarded to a callback nobody passed, and the two together
  // made it look like the flush was covered twice when it was covered once. The scheduler
  // test is where that requirement is pinned.
  it('registers beforeunload while running', () => {
    const add = vi.spyOn(window, 'addEventListener')
    renderHook(() => useUnloadWarning({ active: true }))
    const types = add.mock.calls.map(([type]) => type)
    expect(types).toContain('beforeunload')
    expect(types).not.toContain('pagehide')
    add.mockRestore()
  })

  it('removes its listener on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useUnloadWarning({ active: true }))
    unmount()
    const types = remove.mock.calls.map(([type]) => type)
    expect(types).toContain('beforeunload')
    remove.mockRestore()
  })

  // W3: the prompt must never be able to stop the timer by being triggered.
  it('preventDefault on beforeunload so the browser shows its own dialog', () => {
    const add = vi.spyOn(window, 'addEventListener')
    renderHook(() => useUnloadWarning({ active: true }))
    const beforeUnload = add.mock.calls.find(
      ([type]) => type === 'beforeunload',
    )?.[1] as EventListener
    const preventDefault = vi.fn()
    const event = {
      preventDefault,
      returnValue: 'unset',
    } as unknown as BeforeUnloadEvent
    beforeUnload(event)
    expect(preventDefault).toHaveBeenCalled()
    expect(event.returnValue).toBe('')
    add.mockRestore()
  })

  it('stops warning once dismissed (0004 W6)', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const { result } = renderHook(() => useUnloadWarning({ active: true, sessionKey: 'a' }))
    expect(result.current.dismissed).toBe(false)

    act(() => result.current.dismiss())
    expect(result.current.dismissed).toBe(true)

    const count = add.mock.calls.filter(([type]) => type === 'beforeunload').length
    expect(count).toBe(1)
    add.mockRestore()
  })

  // W6: suppression is per session, not permanent.
  it('resets dismissal when a new timer starts', () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string | null }) => useUnloadWarning({ active: true, sessionKey: key }),
      { initialProps: { key: 'entry-a' } },
    )

    act(() => result.current.dismiss())
    expect(result.current.dismissed).toBe(true)

    rerender({ key: 'entry-b' })
    expect(result.current.dismissed).toBe(false)
  })

  it('does not stack listeners when the session changes', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const { rerender } = renderHook(
      ({ key }: { key: string }) => useUnloadWarning({ active: true, sessionKey: key }),
      { initialProps: { key: 'a' } },
    )
    rerender({ key: 'b' })
    const registrations = add.mock.calls.filter(([type]) => type === 'beforeunload').length
    expect(registrations).toBe(1)
    add.mockRestore()
  })

  it('renders in a component context without error', () => {
    function Probe() {
      const { dismissed } = useUnloadWarning({ active: true })
      return <span>{dismissed ? 'quiet' : 'warn'}</span>
    }
    render(<Probe />)
    expect(document.body.textContent).toContain('warn')
  })
})
