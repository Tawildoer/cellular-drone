import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppStoresContext, type AppStores } from '../../../app/store-hooks'
import { MockLink } from '../../../link/mock'
import { LocalStorageMissionRepository } from '../../../services/local-storage'
import { MockAuthClient } from '../../../services/mock'
import { createAuthStore, createMissionStore, createVehicleStore } from '../../../state'
import { LoginScreen } from '../LoginScreen'

function renderWithStores() {
  const stores: AppStores = {
    authStore: createAuthStore(new MockAuthClient({ username: 'operator', password: 'secret' })),
    vehicleStore: createVehicleStore(new MockLink()),
    missionStore: createMissionStore(new LocalStorageMissionRepository({ storageKey: 'test:login-screen' })),
  }

  render(
    <AppStoresContext.Provider value={stores}>
      <LoginScreen />
    </AppStoresContext.Provider>,
  )

  return stores
}

describe('LoginScreen', () => {
  it('logs in with valid credentials', async () => {
    const stores = renderWithStores()

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'operator' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(stores.authStore.getState().user).toEqual({ username: 'operator' }))
  })

  it('shows an error on bad credentials and does not log in', async () => {
    const stores = renderWithStores()

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'operator' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(stores.authStore.getState().user).toBeNull()
  })
})
