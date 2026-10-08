import { createStore } from 'zustand/vanilla'
import type {
  Command,
  CommandResult,
  LinkState,
  LinkStatus,
  Mission,
  MissionUploadResult,
  VehicleEvent,
  VehicleMissionItem,
  VehicleState,
} from '../domain'
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
  /** The flight controller's own copy of `missionOnVehicle`, read back after
   * the upload, when the vehicle reports one (ADR-0017). Null when unknown. */
  missionOnVehicleReadback: VehicleMissionItem[] | null
  /** The link backing the current connection, or null when disconnected.
   * App-level wiring (e.g. dev tools) reads this; features use the methods. */
  activeLink: VehicleLink | null

  connect(vehicleId: string): Promise<void>
  disconnect(): Promise<void>
  send(cmd: Command): Promise<CommandResult>
  uploadMission(mission: Mission): Promise<MissionUploadResult>
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

  return createStore<VehicleStoreState>((set, get) => ({
    connectionState: 'disconnected',
    vehicleState: null,
    linkStatus: null,
    linkHistory: [],
    events: [],
    videoStream: null,
    missionOnVehicle: null,
    missionOnVehicleReadback: null,
    activeLink: null,

    async connect(vehicleId) {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      const current = resolve(vehicleId)
      link = current

      // Adopt whatever the vehicle is already flying each time the link
      // becomes connected (first connect and every reconnect), so joining a
      // drone mid-mission shows its actual route. Waits for "connected"
      // because some links (WebRTC) resolve connect() before they can carry
      // requests. If this page uploads a mission meanwhile, that one wins.
      const adoptVehicleMission = async () => {
        const before = get().missionOnVehicle
        const onVehicle = await current.downloadMission()
        if (!onVehicle || link !== current || get().missionOnVehicle !== before) return
        // A downloaded mission comes without a readback; drop any stale one.
        set({ missionOnVehicle: onVehicle, missionOnVehicleReadback: null })
      }

      unsubscribers = [
        link.onState((vehicleState) => set({ vehicleState })),
        link.onLinkStatus((linkStatus) => {
          const wasConnected = get().connectionState === 'connected'
          set((s) => ({
            linkStatus,
            connectionState: linkStatus.state,
            linkHistory: appendLinkHistory(s.linkHistory, linkStatus, Date.now()),
          }))
          if (linkStatus.state === 'connected' && !wasConnected) void adoptVehicleMission()
        }),
        link.onEvent((event) => set((s) => ({ events: [...s.events, event].slice(-MAX_EVENTS) }))),
        link.onVideoStream((videoStream) => set({ videoStream })),
      ]
      set({ activeLink: link })
      await link.connect(vehicleId)
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
        missionOnVehicleReadback: null,
        activeLink: null,
      })
    },

    send: (cmd) => (link ? link.send(cmd) : Promise.resolve<CommandResult>({ ok: false, reason: 'not_connected' })),
    async uploadMission(mission) {
      if (!link) return { ok: false, reason: 'not_connected' }
      const result = await link.uploadMission(mission)
      if (result.ok) set({ missionOnVehicle: mission, missionOnVehicleReadback: result.onVehicle ?? null })
      return result
    },
    downloadMission: () => (link ? link.downloadMission() : Promise.resolve(null)),
  }))
}

export type VehicleStore = ReturnType<typeof createVehicleStore>
