import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppStoresContext, type AppStores } from '../../../app/store-hooks'
import { MockLink } from '../../../link/mock'
import { LocalStorageMissionRepository } from '../../../services/local-storage'
import { MockAuthClient } from '../../../services/mock'
import { createAuthStore, createMissionStore, createVehicleStore } from '../../../state'
import { MissionSelector } from '../MissionSelector'

let storageCounter = 0

function renderSelector() {
  const missionStore = createMissionStore(
    new LocalStorageMissionRepository({ storageKey: `test:mission-selector-${storageCounter++}` }),
  )
  const vehicleStore = createVehicleStore(new MockLink({ tickMs: 20 }))
  const stores: AppStores = {
    authStore: createAuthStore(new MockAuthClient()),
    vehicleStore,
    missionStore,
  }
  render(
    <AppStoresContext.Provider value={stores}>
      <MissionSelector />
    </AppStoresContext.Provider>,
  )
  return { missionStore, vehicleStore }
}

async function saveMission(missionStore: ReturnType<typeof createMissionStore>, name: string) {
  missionStore.getState().newDraft()
  missionStore.getState().updateDraft({ name, items: [{ type: 'vtolTakeoff', altM: 50 }, { type: 'returnToLaunch' }] })
  return missionStore.getState().save()
}

describe('MissionSelector', () => {
  it('shows "None selected" with no saved missions', async () => {
    renderSelector()
    await waitFor(() => expect(screen.getByLabelText('Choose active mission')).toHaveTextContent('None selected'))
  })

  it('shows the active mission name on the collapsed toggle', async () => {
    const { missionStore } = renderSelector()
    await saveMission(missionStore, 'Patrol Route')
    await waitFor(() => expect(screen.getByLabelText('Choose active mission')).toHaveTextContent('Patrol Route'))
  })

  it('opens to list saved missions and selecting one loads it as the draft', async () => {
    const { missionStore } = renderSelector()
    await saveMission(missionStore, 'Patrol Route')
    await saveMission(missionStore, 'Survey Grid')
    await waitFor(() => expect(screen.getByLabelText('Choose active mission')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Choose active mission'))
    await waitFor(() => expect(screen.getByText('Survey Grid')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Survey Grid'))
    await waitFor(() => expect(missionStore.getState().draft?.name).toBe('Survey Grid'))
  })

  it('re-uploads the selected mission to the vehicle when connected', async () => {
    const { missionStore, vehicleStore } = renderSelector()
    await saveMission(missionStore, 'Patrol Route')
    const survey = await saveMission(missionStore, 'Survey Grid')
    await vehicleStore.getState().connect('drone-1')

    await waitFor(() => expect(screen.getByLabelText('Choose active mission')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Choose active mission'))
    await waitFor(() => expect(screen.getByText('Survey Grid')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Survey Grid'))

    await waitFor(async () => expect((await vehicleStore.getState().downloadMission())?.id).toBe(survey?.id))
    await vehicleStore.getState().disconnect()
  })

  it('closes back to the collapsed toggle', async () => {
    renderSelector()
    await waitFor(() => expect(screen.getByLabelText('Choose active mission')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Choose active mission'))
    await waitFor(() => expect(screen.getByLabelText('Close mission chooser')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Close mission chooser'))
    expect(screen.getByLabelText('Choose active mission')).toBeInTheDocument()
  })
})
