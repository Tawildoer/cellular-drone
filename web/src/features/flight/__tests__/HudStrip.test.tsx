import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppStoresContext, type AppStores } from '../../../app/store-hooks'
import { MockLink } from '../../../link/mock'
import { LocalStorageMissionRepository } from '../../../services/local-storage'
import { MockAuthClient } from '../../../services/mock'
import { createAuthStore, createMissionStore, createVehicleStore } from '../../../state'
import { HudStrip } from '../HudStrip'

function renderWithStores(vehicleStore: ReturnType<typeof createVehicleStore>) {
  const stores: AppStores = {
    authStore: createAuthStore(new MockAuthClient()),
    vehicleStore,
    missionStore: createMissionStore(new LocalStorageMissionRepository({ storageKey: 'test:hud-strip' })),
  }

  render(
    <AppStoresContext.Provider value={stores}>
      <HudStrip />
    </AppStoresContext.Provider>,
  )
}

describe('HudStrip', () => {
  it('shows a waiting state before telemetry arrives', () => {
    renderWithStores(createVehicleStore(new MockLink()))
    expect(screen.getByText(/waiting for telemetry/i)).toBeInTheDocument()
  })

  it('renders live telemetry once connected', async () => {
    const vehicleStore = createVehicleStore(new MockLink({ tickMs: 20 }))
    renderWithStores(vehicleStore)

    await vehicleStore.getState().connect('drone-1')
    await waitFor(() => expect(vehicleStore.getState().vehicleState).not.toBeNull())

    expect(await screen.findByText('Flight mode')).toBeInTheDocument()
    expect(screen.getByText('Disarmed')).toBeInTheDocument()
    expect(screen.getByText(/°$/)).toBeInTheDocument()

    await vehicleStore.getState().disconnect()
  })
})
