import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppStoresContext, type AppStores } from '../../../app/store-hooks'
import { fromLocalEastNorthM, type Mission, type VehicleState } from '../../../domain'
import { MockLink } from '../../../link/mock'
import { LocalStorageMissionRepository } from '../../../services/local-storage'
import { MockAuthClient } from '../../../services/mock'
import { createAuthStore, createMissionStore, createVehicleStore } from '../../../state'
import { MissionProgressPanel } from '../MissionProgressPanel'
import { FailsafeBanners, TelemetryStaleBanner } from '../StatusBanners'

const HOME = { lat: -37.861, lon: 145.062 }
const at = (northM: number) => fromLocalEastNorthM(HOME, 0, northM)

const mission: Mission = {
  id: 'm',
  name: 'm',
  createdAt: 0,
  updatedAt: 0,
  items: [
    { type: 'vtolTakeoff', altM: 40 },
    { type: 'waypoint', ...at(1000), altM: 60 },
    { type: 'waypoint', ...at(2000), altM: 60 },
    { type: 'returnToLaunch' },
  ],
}

function state(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicleId: 'v',
    position: { ...at(1500), altRelM: 60, altAmslM: 110 },
    attitude: { rollDeg: 0, pitchDeg: 0, yawDeg: 0 },
    groundSpeedMps: 25,
    airspeedMps: 25,
    climbMps: 0,
    battery: { voltageV: 24, currentA: 10, percent: 80 },
    gps: { fixType: 'fix3d', satellites: 12, hdop: 0.8 },
    flightMode: 'AUTO',
    armed: true,
    vtolState: 'fw',
    landed: false,
    home: { ...HOME, altAmslM: 50 },
    missionProgress: { currentIndex: 2, total: 4 },
    rc: { linked: true, overrideActive: false },
    failsafe: { gcs: false, battery: false, geofence: false, rc: false },
    updatedAt: 0,
    ...overrides,
  }
}

function renderWith(ui: React.ReactNode, vehicleState: VehicleState | null, vehicleStateAt: number | null = Date.now()) {
  const vehicleStore = createVehicleStore(new MockLink())
  vehicleStore.setState({ vehicleState, vehicleStateAt })
  const stores: AppStores = {
    authStore: createAuthStore(new MockAuthClient()),
    vehicleStore,
    missionStore: createMissionStore(new LocalStorageMissionRepository({ storageKey: `test:awareness-${Math.random()}` })),
  }
  return render(<AppStoresContext.Provider value={stores}>{ui}</AppStoresContext.Provider>)
}

describe('MissionProgressPanel', () => {
  it('shows the item being flown, what is left and the way home', () => {
    renderWith(<MissionProgressPanel mission={mission} />, state())
    expect(screen.getByText(/^3\/4 · Waypoint · (499|500) m$/)).toBeInTheDocument()
    expect(screen.getByText(/^~\d+:\d\d · 2\.5 km$/)).toBeInTheDocument()
    expect(screen.getByText(/^1\.5 km · ~\d+:\d\d$/)).toBeInTheDocument()
  })

  it('says paused, and returning home on RTL', () => {
    const { unmount } = renderWith(<MissionProgressPanel mission={mission} />, state({ flightMode: 'LOITER' }))
    expect(screen.getByText('Paused')).toBeInTheDocument()
    unmount()
    renderWith(<MissionProgressPanel mission={mission} />, state({ flightMode: 'RTL' }))
    expect(screen.getByText('Returning home')).toBeInTheDocument()
  })

  it('gives no estimate for a mission the vehicle is not flying, and hides on the ground', () => {
    const { unmount } = renderWith(<MissionProgressPanel mission={mission} />, state({ missionProgress: { currentIndex: 2, total: 9 } }))
    expect(screen.getByText('3/9')).toBeInTheDocument()
    expect(screen.queryByText('Left')).toBeNull()
    unmount()
    const { container } = renderWith(<MissionProgressPanel mission={mission} />, state({ armed: false }))
    expect(container).toBeEmptyDOMElement()
  })
})

describe('status banners', () => {
  it('shows one banner per active failsafe, RC loss as a warning that the mission continues', () => {
    renderWith(<FailsafeBanners />, state({ failsafe: { gcs: false, battery: true, geofence: false, rc: true } }))
    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(screen.getByText(/Battery failsafe/)).toBeInTheDocument()
    expect(screen.getByText(/RC link lost: in AUTO the mission continues/)).toBeInTheDocument()
  })

  it('warns when telemetry has stopped, and not while it is fresh', () => {
    const { unmount } = renderWith(<TelemetryStaleBanner />, state(), Date.now())
    expect(screen.queryByRole('alert')).toBeNull()
    unmount()
    renderWith(<TelemetryStaleBanner />, state(), Date.now() - 8_000)
    expect(screen.getByRole('alert')).toHaveTextContent('No telemetry for 8 s')
  })
})
