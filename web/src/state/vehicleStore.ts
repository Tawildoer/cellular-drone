import { createStore } from 'zustand/vanilla'
import type { Command, CommandResult, LinkState, LinkStatus, Mission, VehicleEvent, VehicleState } from '../domain'
import type { VehicleLink } from '../link'

const MAX_EVENTS = 200

export interface VehicleStoreState {
  connectionState: LinkState
  vehicleState: VehicleState | null
  linkStatus: LinkStatus | null
  events: VehicleEvent[]
  videoStream: MediaStream | null
  /** The mission the vehicle last *accepted* — what it will actually fly,
   * as opposed to whatever is being edited or was merely saved locally. */
  missionOnVehicle: Mission | null

  connect(vehicleId: string): Promise<void>
  disconnect(): Promise<void>
  send(cmd: Command): Promise<CommandResult>
  uploadMission(mission: Mission): Promise<CommandResult>
  downloadMission(): Promise<Mission | null>
}

export function createVehicleStore(link: VehicleLink) {
  let unsubscribers: (() => void)[] = []

  return createStore<VehicleStoreState>((set) => ({
    connectionState: 'disconnected',
    vehicleState: null,
    linkStatus: null,
    events: [],
    videoStream: null,
    missionOnVehicle: null,

    async connect(vehicleId) {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      unsubscribers = [
        link.onState((vehicleState) => set({ vehicleState })),
        link.onLinkStatus((linkStatus) => set({ linkStatus, connectionState: linkStatus.state })),
        link.onEvent((event) => set((s) => ({ events: [...s.events, event].slice(-MAX_EVENTS) }))),
        link.onVideoStream((videoStream) => set({ videoStream })),
      ]
      await link.connect(vehicleId)
    },

    async disconnect() {
      await link.disconnect()
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      unsubscribers = []
      set({ connectionState: 'disconnected', vehicleState: null, linkStatus: null, videoStream: null, missionOnVehicle: null })
    },

    send: (cmd) => link.send(cmd),
    async uploadMission(mission) {
      const result = await link.uploadMission(mission)
      if (result.ok) set({ missionOnVehicle: mission })
      return result
    },
    downloadMission: () => link.downloadMission(),
  }))
}

export type VehicleStore = ReturnType<typeof createVehicleStore>
