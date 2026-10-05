import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppStoresContext, type AppStores } from '../../../app/store-hooks'
import type { Mission } from '../../../domain'
import { MockLink } from '../../../link/mock'
import { LocalStorageMissionRepository } from '../../../services/local-storage'
import { MockAuthClient } from '../../../services/mock'
import { createAuthStore, createMissionStore, createVehicleStore } from '../../../state'
import { PreflightChecklist } from '../PreflightChecklist'

const validMission: Mission = {
  id: 'm1',
  name: 'test',
  items: [{ type: 'vtolTakeoff', altM: 50 }, { type: 'returnToLaunch' }],
  createdAt: 0,
  updatedAt: 0,
}

async function renderWithStores(mission: Mission | null) {
  const vehicleStore = createVehicleStore(new MockLink({ tickMs: 20 }))
  const stores: AppStores = {
    authStore: createAuthStore(new MockAuthClient()),
    vehicleStore,
    missionStore: createMissionStore(new LocalStorageMissionRepository({ storageKey: 'test:checklist' })),
  }

  render(
    <AppStoresContext.Provider value={stores}>
      <PreflightChecklist mission={mission} />
    </AppStoresContext.Provider>,
  )

  await vehicleStore.getState().connect('drone-1')
  return vehicleStore
}

describe('PreflightChecklist', () => {
  it('shows a waiting state before telemetry arrives', async () => {
    const vehicleStore = createVehicleStore(new MockLink())
    const stores: AppStores = {
      authStore: createAuthStore(new MockAuthClient()),
      vehicleStore,
      missionStore: createMissionStore(new LocalStorageMissionRepository({ storageKey: 'test:checklist-waiting' })),
    }
    render(
      <AppStoresContext.Provider value={stores}>
        <PreflightChecklist mission={validMission} />
      </AppStoresContext.Provider>,
    )
    expect(screen.getByText(/waiting for telemetry/i)).toBeInTheDocument()
  })

  it('is not ready without a mission', async () => {
    await renderWithStores(null)
    await waitFor(() => expect(screen.getByText('Preflight not ready')).toBeInTheDocument())
  })

  it('disappears entirely once every check passes, rather than showing a wall of green', async () => {
    const vehicleStore = await renderWithStores(validMission)
    await waitFor(
      () => {
        expect(screen.queryByText('Preflight not ready')).not.toBeInTheDocument()
      },
      { timeout: 4000 },
    )
    await vehicleStore.getState().disconnect()
  })

  it('lists only the failing checks, not ones that already passed', async () => {
    await renderWithStores(null) // no mission -> missionLoaded/missionValid fail, but GPS/battery/etc. pass once connected
    await waitFor(() => expect(screen.getByText('Preflight not ready')).toBeInTheDocument())
    expect(screen.getByText('Mission loaded')).toBeInTheDocument()
    expect(screen.queryByText('No active failsafe')).not.toBeInTheDocument()
  })
})
