import type { VehicleLink } from '../link'
import { MockLink } from '../link/mock'
import { WsLink } from '../link/ws'
import type { AuthClient, MissionRepository } from '../services'
import { LocalStorageMissionRepository } from '../services/local-storage'
import { MockAuthClient } from '../services/mock'

export interface AppServices {
  authClient: AuthClient
  vehicleLink: VehicleLink
  missionRepository: MissionRepository
}

function createVehicleLink(): VehicleLink {
  const kind = import.meta.env.VITE_VEHICLE_LINK ?? 'mock'
  switch (kind) {
    case 'ws':
      return new WsLink({ url: import.meta.env.VITE_WS_URL })
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
  return {
    authClient: new MockAuthClient(),
    vehicleLink: createVehicleLink(),
    missionRepository: new LocalStorageMissionRepository(),
  }
}
