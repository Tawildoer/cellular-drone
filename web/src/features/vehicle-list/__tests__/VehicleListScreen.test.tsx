import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppStoresContext, type AppStores } from '../../../app/store-hooks'
import { MockLink } from '../../../link/mock'
import { LocalStorageMissionRepository } from '../../../services/local-storage'
import { MockAuthClient } from '../../../services/mock'
import { createAuthStore, createMissionStore, createVehicleStore } from '../../../state'
import { VehicleListScreen } from '../VehicleListScreen'

async function renderWithStores(onConnected: (vehicleId: string) => void) {
  const stores: AppStores = {
    authStore: createAuthStore(new MockAuthClient({ username: 'operator', password: 'secret' })),
    vehicleStore: createVehicleStore(new MockLink({ tickMs: 20 })),
    missionStore: createMissionStore(new LocalStorageMissionRepository({ storageKey: 'test:vehicle-list' })),
  }
  await stores.authStore.getState().login('operator', 'secret')

  render(
    <AppStoresContext.Provider value={stores}>
      <VehicleListScreen vehicles={[{ id: 'drone-1', name: 'Drone 1' }]} onConnected={onConnected} />
    </AppStoresContext.Provider>,
  )

  return stores
}

describe('VehicleListScreen', () => {
  it('shows the signed-in username', async () => {
    await renderWithStores(() => {})
    expect(screen.getByText(/signed in as operator/i)).toBeInTheDocument()
  })

  it('connects the vehicle link and calls onConnected', async () => {
    const onConnected = vi.fn()
    const stores = await renderWithStores(onConnected)

    fireEvent.click(screen.getByRole('button', { name: /connect/i }))

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith('drone-1'))
    expect(stores.vehicleStore.getState().connectionState).toBe('connected')
  })

  it('logs out', async () => {
    const stores = await renderWithStores(() => {})
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(stores.authStore.getState().user).toBeNull())
  })
})
