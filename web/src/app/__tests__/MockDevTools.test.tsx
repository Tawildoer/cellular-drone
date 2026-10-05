import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MockLink } from '../../link/mock'
import { MockDevTools } from '../MockDevTools'

describe('MockDevTools', () => {
  it('is collapsed to a toggle by default', () => {
    render(<MockDevTools link={new MockLink()} />)
    expect(screen.getByLabelText('Show dev tools')).toBeInTheDocument()
    expect(screen.queryByText(/dev tools/i, { selector: 'span' })).not.toBeInTheDocument()
  })

  it('opens to show the current sim speed and look-ahead distance', () => {
    const link = new MockLink()
    link.setTimeScale(5)
    link.setFaultConfig({ lookAheadM: 60 })
    render(<MockDevTools link={link} />)

    fireEvent.click(screen.getByLabelText('Show dev tools'))
    expect(screen.getByLabelText('Simulation speed multiplier')).toHaveValue('5')
    expect(screen.getByLabelText('Guidance look-ahead distance, meters')).toHaveValue('60')
  })

  it('dragging the sim speed slider calls setTimeScale on the link', () => {
    const link = new MockLink()
    render(<MockDevTools link={link} />)
    fireEvent.click(screen.getByLabelText('Show dev tools'))

    fireEvent.change(screen.getByLabelText('Simulation speed multiplier'), { target: { value: '10' } })
    expect(link.getTimeScale()).toBe(10)
  })

  it('dragging the look-ahead slider calls setFaultConfig on the link', () => {
    const link = new MockLink()
    render(<MockDevTools link={link} />)
    fireEvent.click(screen.getByLabelText('Show dev tools'))

    fireEvent.change(screen.getByLabelText('Guidance look-ahead distance, meters'), { target: { value: '100' } })
    expect(link.getFaultConfig().lookAheadM).toBe(100)
  })

  it('closes back to the toggle', () => {
    render(<MockDevTools link={new MockLink()} />)
    fireEvent.click(screen.getByLabelText('Show dev tools'))
    fireEvent.click(screen.getByLabelText('Hide dev tools'))
    expect(screen.getByLabelText('Show dev tools')).toBeInTheDocument()
  })
})
