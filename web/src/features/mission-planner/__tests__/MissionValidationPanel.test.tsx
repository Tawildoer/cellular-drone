import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Mission } from '../../../domain'
import { MissionValidationPanel } from '../MissionValidationPanel'

function missionWith(items: Mission['items']): Mission {
  return { id: 'm1', name: 'test', items, createdAt: 0, updatedAt: 0 }
}

describe('MissionValidationPanel', () => {
  it('shows a valid state for a well-formed mission', () => {
    render(
      <MissionValidationPanel
        mission={missionWith([{ type: 'vtolTakeoff', altM: 50 }, { type: 'returnToLaunch' }])}
      />,
    )
    expect(screen.getByText('Mission valid')).toBeInTheDocument()
  })

  it('lists issues for an invalid mission', () => {
    render(<MissionValidationPanel mission={missionWith([{ type: 'returnToLaunch' }])} />)
    expect(screen.getByText(/issue/)).toBeInTheDocument()
  })
})
