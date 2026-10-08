import { fromLocalEastNorthM, type HomePosition, type Mission, type VehicleDescriptor } from '../domain'
import type { VehicleLink } from '../link'
import { MockLink } from '../link/mock'
import { WebRtcLink } from '../link/webrtc'
import { WsLink } from '../link/ws'
import type { AuthClient, MissionRepository, MissionTranslator, TerrainService } from '../services'
import { ArduPilotMissionTranslator } from '../services/ardupilot'
import { LocalStorageMissionRepository } from '../services/local-storage'
import { MapTilerTerrainService } from '../services/maptiler'
import { MockAuthClient } from '../services/mock'

export const DEMO_VEHICLE_ID = 'demo'

const DEMO_HOME: HomePosition = { lat: -37.861, lon: 145.062, altAmslM: 50 }

/** A point `eastM`/`northM` metres from the demo drone's home. */
function fromDemoHome(eastM: number, northM: number) {
  return fromLocalEastNorthM(DEMO_HOME, eastM, northM)
}

/**
 * A ~15km loop around the demo home (~14 minutes at cruise), long enough to
 * exercise the map at every zoom: eight legs of about 1.3–2km each (each
 * under the floating path's 3km dash cap, flightMapGeo.ts), varying altitude,
 * then a long loiter near home and RTL. The demo drone flies this
 * automatically so the map always has something moving on it. Must stay
 * valid per domain/validation — the sim silently refuses an invalid mission.
 */
export const DEMO_MISSION: Mission = {
  id: 'demo-mission',
  name: 'Demo patrol',
  items: [
    { type: 'vtolTakeoff', altM: 60 },
    { type: 'waypoint', ...fromDemoHome(600, 1200), altM: 80 },
    { type: 'waypoint', ...fromDemoHome(2200, 1800), altM: 100 },
    { type: 'waypoint', ...fromDemoHome(3800, 900), altM: 100 },
    { type: 'waypoint', ...fromDemoHome(4200, -1000), altM: 90 },
    { type: 'waypoint', ...fromDemoHome(2800, -2400), altM: 80 },
    { type: 'waypoint', ...fromDemoHome(800, -2200), altM: 70 },
    { type: 'waypoint', ...fromDemoHome(-800, -1000), altM: 60 },
    { type: 'loiter', ...fromDemoHome(300, 500), altM: 60, radiusM: 120, turns: 100 },
    { type: 'returnToLaunch' },
  ],
  createdAt: 0,
  updatedAt: 0,
}

const configuredKind = import.meta.env.VITE_VEHICLE_LINK ?? 'mock'

/**
 * The demo drone is always present and always runs the in-browser sim, so the
 * app can be shown off with no backend. Real vehicles only appear once a real
 * transport is configured — there is nothing to connect to in a mock build.
 */
export const VEHICLES: VehicleDescriptor[] = [
  { id: DEMO_VEHICLE_ID, name: 'Demo Drone', demo: true },
  ...(configuredKind === 'mock' ? [] : [{ id: 'drone-1', name: 'Drone 1' }]),
]

export interface AppServices {
  authClient: AuthClient
  /**
   * Resolves the link for a selected vehicle. The demo vehicle always gets a
   * fresh MockLink (a clean airborne mission each time it's opened); real
   * vehicles share one configured link. Only this file may name concrete link
   * implementations (docs/FRONTEND.md).
   */
  resolveVehicleLink: (vehicleId: string) => VehicleLink
  vehicles: VehicleDescriptor[]
  missionRepository: MissionRepository
  /** How missions look to the flight stack, for planner preview and export
   * (ADR-0017). The agent does the authoritative translation on upload. */
  missionTranslator: MissionTranslator
  /** Ground elevation for the planner's terrain profile; null without a
   * MapTiler key (the same key the map's 3D terrain needs). */
  terrain: TerrainService | null
}

function iceServersFromEnv(): RTCIceServer[] | undefined {
  const urls: unknown = import.meta.env.VITE_ICE_URLS
  if (typeof urls !== 'string') return undefined
  return urls
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => ({ urls: url }))
}

function createConfiguredLink(): VehicleLink {
  switch (configuredKind) {
    case 'ws':
      return new WsLink({ url: import.meta.env.VITE_WS_URL })
    case 'webrtc':
      return new WebRtcLink({
        signalUrl: import.meta.env.VITE_SIGNAL_URL,
        iceServers: iceServersFromEnv(),
        relayOnly: import.meta.env.VITE_ICE_RELAY_ONLY === 'true',
      })
    case 'mock':
    default:
      return new MockLink()
  }
}

/**
 * The only place in the app allowed to construct a concrete VehicleLink /
 * AuthClient / MissionRepository (docs/FRONTEND.md). Everything downstream
 * — state/ and features/ — sees only the interfaces.
 */
export function createAppServices(): AppServices {
  const maptilerKey: unknown = import.meta.env.VITE_MAPTILER_KEY
  let configuredLink: VehicleLink | null = null
  const resolveVehicleLink = (vehicleId: string): VehicleLink => {
    if (vehicleId === DEMO_VEHICLE_ID) {
      return new MockLink({ home: DEMO_HOME, autoFly: { mission: DEMO_MISSION, warmUpS: 40 } })
    }
    configuredLink ??= createConfiguredLink()
    return configuredLink
  }

  return {
    authClient: new MockAuthClient(),
    resolveVehicleLink,
    vehicles: VEHICLES,
    missionRepository: new LocalStorageMissionRepository(),
    missionTranslator: new ArduPilotMissionTranslator(),
    terrain: typeof maptilerKey === 'string' && maptilerKey ? new MapTilerTerrainService(maptilerKey) : null,
  }
}
