import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { AppStoresContext, type AppStores } from '../../../app/store-hooks'
import type { Mission } from '../../../domain'
import { MockLink } from '../../../link/mock'
import { LocalStorageMissionRepository } from '../../../services/local-storage'
import { MockAuthClient } from '../../../services/mock'
import { createAuthStore, createMissionStore, createVehicleStore } from '../../../state'
import { MissionValidationPanel } from '../MissionValidationPanel'

// The panel reads the vehicle (home, charge) for its battery line.
function renderWithStores(ui: ReactElement) {
  const stores: AppStores = {
    authStore: createAuthStore(new MockAuthClient()),
    vehicleStore: createVehicleStore(new MockLink()),
    missionStore: createMissionStore(new LocalStorageMissionRepository({ storageKey: 'test:validation' })),
  }
  return render(<AppStoresContext.Provider value={stores}>{ui}</AppStoresContext.Provider>)
}

function missionWith(items: Mission['items']): Mission {
  return { id: 'm1', name: 'test', items, createdAt: 0, updatedAt: 0 }
}

describe('MissionValidationPanel', () => {
  it('shows a valid state for a well-formed mission', () => {
    renderWithStores(
      <MissionValidationPanel
        mission={missionWith([{ type: 'vtolTakeoff', altM: 50 }, { type: 'returnToLaunch' }])}
      />,
    )
    expect(screen.getByText('Mission valid')).toBeInTheDocument()
  })

  it('lists issues for an invalid mission', () => {
    renderWithStores(<MissionValidationPanel mission={missionWith([{ type: 'returnToLaunch' }])} />)
    expect(screen.getByText(/issue/)).toBeInTheDocument()
  })
})
