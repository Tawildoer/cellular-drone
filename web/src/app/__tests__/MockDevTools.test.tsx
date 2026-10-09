import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MockLink } from '../../link/mock'
import { MockDevToolsPanel } from '../MockDevTools'

describe('MockDevToolsPanel', () => {
  it('shows the current sim speed and look-ahead distance', () => {
    const link = new MockLink()
    link.setTimeScale(5)
    link.setFaultConfig({ lookAheadM: 60 })
    render(<MockDevToolsPanel link={link} />)

    expect(screen.getByLabelText('Simulation speed multiplier')).toHaveValue('5')
    expect(screen.getByLabelText('Guidance look-ahead distance, meters')).toHaveValue('60')
  })

  it('dragging the sim speed slider calls setTimeScale on the link', () => {
    const link = new MockLink()
    render(<MockDevToolsPanel link={link} />)

    fireEvent.change(screen.getByLabelText('Simulation speed multiplier'), { target: { value: '10' } })
    expect(link.getTimeScale()).toBe(10)
  })

  it('dragging the look-ahead slider calls setFaultConfig on the link', () => {
    const link = new MockLink()
    render(<MockDevToolsPanel link={link} />)

    fireEvent.change(screen.getByLabelText('Guidance look-ahead distance, meters'), { target: { value: '100' } })
    expect(link.getFaultConfig().lookAheadM).toBe(100)
  })
})
