import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppStoresContext, type AppStores } from '../../../app/store-hooks'
import { MockLink } from '../../../link/mock'
import { LocalStorageMissionRepository } from '../../../services/local-storage'
import { MockAuthClient } from '../../../services/mock'
import { createAuthStore, createMissionStore, createVehicleStore } from '../../../state'
import { MissionListPanel } from '../MissionListPanel'

let storageCounter = 0

function renderPanel() {
  const missionStore = createMissionStore(
    new LocalStorageMissionRepository({ storageKey: `test:mission-list-${storageCounter++}` }),
  )
  const stores: AppStores = {
    authStore: createAuthStore(new MockAuthClient()),
    vehicleStore: createVehicleStore(new MockLink()),
    missionStore,
  }
  render(
    <AppStoresContext.Provider value={stores}>
      <MissionListPanel />
    </AppStoresContext.Provider>,
  )
  return missionStore
}

describe('MissionListPanel', () => {
  it('shows an empty state with no saved missions', async () => {
    renderPanel()
    await waitFor(() => expect(screen.getByText('No saved missions')).toBeInTheDocument())
  })

  it('creates a new, already-valid draft via the new-mission button', () => {
    const missionStore = renderPanel()
    fireEvent.click(screen.getByLabelText('New mission'))
    expect(missionStore.getState().draft?.items.map((i) => i.type)).toEqual(['vtolTakeoff', 'returnToLaunch'])
  })

  it('lists a saved mission and loads it as the draft on click', async () => {
    const missionStore = renderPanel()
    missionStore.getState().newDraft()
    missionStore.getState().updateDraft({ name: 'Saved one', items: [{ type: 'vtolTakeoff', altM: 50 }, { type: 'returnToLaunch' }] })
    await missionStore.getState().save()

    await waitFor(() => expect(screen.getByText('Saved one')).toBeInTheDocument())

    missionStore.getState().newDraft()
    expect(missionStore.getState().draft?.name).toBe('New mission')

    fireEvent.click(screen.getByText('Saved one'))
    await waitFor(() => expect(missionStore.getState().draft?.name).toBe('Saved one'))
  })

  it('deletes a saved mission', async () => {
    const missionStore = renderPanel()
    missionStore.getState().newDraft()
    missionStore.getState().updateDraft({ name: 'To delete', items: [{ type: 'vtolTakeoff', altM: 50 }, { type: 'returnToLaunch' }] })
    await missionStore.getState().save()
    await waitFor(() => expect(screen.getByText('To delete')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Delete To delete'))
    await waitFor(() => expect(screen.queryByText('To delete')).not.toBeInTheDocument())
  })
})
