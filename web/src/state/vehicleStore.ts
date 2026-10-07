import { createStore } from 'zustand/vanilla'
import type { Command, CommandResult, LinkState, LinkStatus, Mission, VehicleEvent, VehicleState } from '../domain'
import type { VehicleLink } from '../link'
import { appendLinkHistory, type LinkHistoryPoint } from './linkHistory'

const MAX_EVENTS = 200

export type VehicleLinkResolver = (vehicleId: string) => VehicleLink

export interface VehicleStoreState {
  connectionState: LinkState
  vehicleState: VehicleState | null
  linkStatus: LinkStatus | null
  /** The last minute of link quality, one point per second. */
  linkHistory: LinkHistoryPoint[]
  events: VehicleEvent[]
  videoStream: MediaStream | null
  /** The mission the vehicle last *accepted* — what it will actually fly,
   * as opposed to whatever is being edited or was merely saved locally. */
  missionOnVehicle: Mission | null
  /** The link backing the current connection, or null when disconnected.
   * App-level wiring (e.g. dev tools) reads this; features use the methods. */
  activeLink: VehicleLink | null

  connect(vehicleId: string): Promise<void>
  disconnect(): Promise<void>
  send(cmd: Command): Promise<CommandResult>
  uploadMission(mission: Mission): Promise<CommandResult>
  downloadMission(): Promise<Mission | null>
}

/**
 * Accepts either a single link (back-compat, and what tests pass) or a
 * resolver that picks the link per selected vehicle (how the app wires it):
 * the demo drone resolves to the in-browser sim, real drones to the
 * configured transport (docs/FRONTEND.md).
 */
export function createVehicleStore(linkOrResolver: VehicleLink | VehicleLinkResolver) {
  const resolve: VehicleLinkResolver =
    typeof linkOrResolver === 'function' ? linkOrResolver : () => linkOrResolver

  let link: VehicleLink | null = null
  let unsubscribers: (() => void)[] = []

  return createStore<VehicleStoreState>((set) => ({
    connectionState: 'disconnected',
    vehicleState: null,
    linkStatus: null,
    linkHistory: [],
    events: [],
    videoStream: null,
    missionOnVehicle: null,
    activeLink: null,

    async connect(vehicleId) {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      link = resolve(vehicleId)
      unsubscribers = [
        link.onState((vehicleState) => set({ vehicleState })),
        link.onLinkStatus((linkStatus) =>
          set((s) => ({
            linkStatus,
            connectionState: linkStatus.state,
            linkHistory: appendLinkHistory(s.linkHistory, linkStatus, Date.now()),
          })),
        ),
        link.onEvent((event) => set((s) => ({ events: [...s.events, event].slice(-MAX_EVENTS) }))),
        link.onVideoStream((videoStream) => set({ videoStream })),
      ]
      set({ activeLink: link })
      await link.connect(vehicleId)
      // Adopt whatever the vehicle is already flying, so connecting to a drone
      // mid-mission (e.g. the auto-flying demo drone) shows its actual route,
      // not an empty map.
      const current = await link.downloadMission()
      if (current) set({ missionOnVehicle: current })
    },

    async disconnect() {
      if (link) await link.disconnect()
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      unsubscribers = []
      link = null
      set({
        connectionState: 'disconnected',
        vehicleState: null,
        linkStatus: null,
        linkHistory: [],
        videoStream: null,
        missionOnVehicle: null,
            activeLink: null,
      })
    },

    send: (cmd) => (link ? link.send(cmd) : Promise.resolve<CommandResult>({ ok: false, reason: 'not_connected' })),
    async uploadMission(mission) {
      if (!link) return { ok: false, reason: 'not_connected' }
      const result = await link.uploadMission(mission)
      if (result.ok) set({ missionOnVehicle: mission })
      return result
    },
    downloadMission: () => (link ? link.downloadMission() : Promise.resolve(null)),
  }))
}

export type VehicleStore = ReturnType<typeof createVehicleStore>
