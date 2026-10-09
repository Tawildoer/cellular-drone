import { fireEvent, render, screen } from '@testing-library/react'
import { Wrench } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { AppStoresContext, MenuExtrasContext, type AppStores, type MenuSection } from '../../../app/store-hooks'
import { MockLink } from '../../../link/mock'
import { LocalStorageMissionRepository } from '../../../services/local-storage'
import { MockAuthClient } from '../../../services/mock'
import { createAuthStore, createMissionStore, createVehicleStore } from '../../../state'
import { MenuDrawer } from '../MenuDrawer'

function renderMenu(extras: MenuSection[] = []) {
  const stores: AppStores = {
    authStore: createAuthStore(new MockAuthClient()),
    vehicleStore: createVehicleStore(new MockLink()),
    missionStore: createMissionStore(new LocalStorageMissionRepository({ storageKey: `test:menu-${Math.random()}` })),
  }
  render(
    <AppStoresContext.Provider value={stores}>
      <MenuExtrasContext.Provider value={extras}>
        <MenuDrawer />
      </MenuExtrasContext.Provider>
    </AppStoresContext.Provider>,
  )
}

describe('MenuDrawer', () => {
  it('is just a button until opened', () => {
    renderMenu()
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Menu' })).toBeNull()
  })

  it('opens on Missions, switches sections, and closes with Escape', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getByRole('region', { name: 'Missions' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Flight log' }))
    expect(screen.getByRole('region', { name: 'Flight log' })).toHaveTextContent('No flights yet')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('complementary', { name: 'Menu' })).toBeNull()
  })

  it('shows sections the app adds, like the simulator', () => {
    renderMenu([{ id: 'simulator', label: 'Simulator', icon: Wrench, content: <p>sim controls</p> }])
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Simulator' }))
    expect(screen.getByRole('region', { name: 'Simulator' })).toHaveTextContent('sim controls')
  })
})
