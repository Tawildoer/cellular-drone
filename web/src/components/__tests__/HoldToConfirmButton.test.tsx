import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HoldToConfirmButton } from '../HoldToConfirmButton'

describe('HoldToConfirmButton', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not confirm immediately on press', () => {
    const onConfirm = vi.fn()
    render(<HoldToConfirmButton onConfirm={onConfirm}>Hold me</HoldToConfirmButton>)

    fireEvent.pointerDown(screen.getByRole('button'))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirms after holding for the full duration', () => {
    const onConfirm = vi.fn()
    render(
      <HoldToConfirmButton onConfirm={onConfirm} durationMs={500}>
        Hold me
      </HoldToConfirmButton>,
    )

    fireEvent.pointerDown(screen.getByRole('button'))
    vi.advanceTimersByTime(500)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('cancels if released before the duration elapses', () => {
    const onConfirm = vi.fn()
    render(
      <HoldToConfirmButton onConfirm={onConfirm} durationMs={500}>
        Hold me
      </HoldToConfirmButton>,
    )

    const button = screen.getByRole('button')
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(300)
    fireEvent.pointerUp(button)
    vi.advanceTimersByTime(500)

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('cancels on pointer leave', () => {
    const onConfirm = vi.fn()
    render(
      <HoldToConfirmButton onConfirm={onConfirm} durationMs={500}>
        Hold me
      </HoldToConfirmButton>,
    )

    const button = screen.getByRole('button')
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(300)
    fireEvent.pointerLeave(button)
    vi.advanceTimersByTime(500)

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('never confirms while disabled', () => {
    const onConfirm = vi.fn()
    render(
      <HoldToConfirmButton onConfirm={onConfirm} durationMs={500} disabled>
        Hold me
      </HoldToConfirmButton>,
    )

    fireEvent.pointerDown(screen.getByRole('button'))
    vi.advanceTimersByTime(500)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirms on a held Enter key, not on a bare keypress', () => {
    const onConfirm = vi.fn()
    render(
      <HoldToConfirmButton onConfirm={onConfirm} durationMs={500}>
        Hold me
      </HoldToConfirmButton>,
    )

    const button = screen.getByRole('button')
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(onConfirm).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('cancels on key up before the duration elapses', () => {
    const onConfirm = vi.fn()
    render(
      <HoldToConfirmButton onConfirm={onConfirm} durationMs={500}>
        Hold me
      </HoldToConfirmButton>,
    )

    const button = screen.getByRole('button')
    fireEvent.keyDown(button, { key: 'Enter' })
    vi.advanceTimersByTime(200)
    fireEvent.keyUp(button, { key: 'Enter' })
    vi.advanceTimersByTime(500)

    expect(onConfirm).not.toHaveBeenCalled()
  })
})
