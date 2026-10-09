import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppStoresContext, type AppStores } from '../../../app/store-hooks'
import type { Mission } from '../../../domain'
import { MockLink } from '../../../link/mock'
import { LocalStorageMissionRepository } from '../../../services/local-storage'
import { MockAuthClient } from '../../../services/mock'
import { createAuthStore, createMissionStore, createVehicleStore } from '../../../state'
import { CommandBar } from '../CommandBar'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const validMission: Mission = {
  id: 'm1',
  name: 'test',
  items: [{ type: 'vtolTakeoff', altM: 50 }, { type: 'returnToLaunch' }],
  createdAt: 0,
  updatedAt: 0,
}

function buildStores(tickMs = 20): { stores: AppStores; vehicleStore: AppStores['vehicleStore'] } {
  const vehicleStore = createVehicleStore(new MockLink({ tickMs }))
  const stores: AppStores = {
    authStore: createAuthStore(new MockAuthClient()),
    vehicleStore,
    missionStore: createMissionStore(new LocalStorageMissionRepository({ storageKey: `test:command-bar-${Math.random()}` })),
  }
  return { stores, vehicleStore }
}

async function renderWithStores(mission: Mission | null) {
  const { stores, vehicleStore } = buildStores()

  render(
    <AppStoresContext.Provider value={stores}>
      <CommandBar mission={mission} />
    </AppStoresContext.Provider>,
  )

  await vehicleStore.getState().connect('drone-1')
  return vehicleStore
}

describe('CommandBar', () => {
  it('shows a waiting state before telemetry arrives', () => {
    const { stores } = buildStores()
    render(
      <AppStoresContext.Provider value={stores}>
        <CommandBar mission={null} />
      </AppStoresContext.Provider>,
    )
    expect(screen.getByText(/waiting for telemetry/i)).toBeInTheDocument()
  })

  it('disables Hold to arm until preflight is ready', async () => {
    const vehicleStore = await renderWithStores(null)
    await waitFor(() => expect(vehicleStore.getState().vehicleState).not.toBeNull())

    expect(screen.getByRole('button', { name: /hold to arm/i })).toBeDisabled()
    await vehicleStore.getState().disconnect()
  })

  it('arms after holding once preflight is ready, then enables mission start', async () => {
    const vehicleStore = await renderWithStores(validMission)
    await waitFor(() => expect(screen.getByRole('button', { name: /hold to arm/i })).toBeEnabled(), { timeout: 4000 })

    fireEvent.pointerDown(screen.getByRole('button', { name: /hold to arm/i }))
    await delay(950)

    await waitFor(() => expect(vehicleStore.getState().vehicleState?.armed).toBe(true))
    expect(screen.getByRole('button', { name: /hold to start mission/i })).toBeEnabled()

    await vehicleStore.getState().disconnect()
  }, 10000)

  it('says why a disabled button is disabled', async () => {
    const vehicleStore = await renderWithStores(null)
    await waitFor(() => expect(vehicleStore.getState().vehicleState).not.toBeNull())
    const reasonOf = (name: RegExp) => screen.getByRole('button', { name }).closest('span[title]')?.getAttribute('title')
    expect(reasonOf(/hold to arm/i)).toMatch(/^Preflight: .*Mission loaded/)
    expect(reasonOf(/hold to start mission/i)).toBe('Arm first')
    expect(reasonOf(/^pause$/i)).toMatch(/AUTO/)
    expect(reasonOf(/hold for rtl/i)).toBe('On the ground')
    await vehicleStore.getState().disconnect()
  })

  it('shows a command as pending, then accepted', async () => {
    const vehicleStore = await renderWithStores(validMission)
    await waitFor(() => expect(screen.getByRole('button', { name: /hold to arm/i })).toBeEnabled(), { timeout: 4000 })
    // Slow the link so the pending state is visible before the result.
    ;(vehicleStore.getState().activeLink as MockLink).setFaultConfig({ latencyMs: 300 })

    fireEvent.pointerDown(screen.getByRole('button', { name: /hold to arm/i }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sending Arm'), { timeout: 2000 })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Arm accepted'), { timeout: 2000 })

    await vehicleStore.getState().disconnect()
  }, 10000)
})

