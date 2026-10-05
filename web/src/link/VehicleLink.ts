import type { Command, CommandResult, LinkStatus, Mission, VehicleEvent, VehicleState } from '../domain'

export type Unsubscribe = () => void

/**
 * The only way UI code talks to a vehicle (docs/FRONTEND.md section 2). The
 * UI knows nothing about WebRTC, MAVLink or server topology — only this
 * interface and the domain/ vocabulary it carries. Every implementation
 * (MockLink, WebRtcLink, ...) must pass link/__tests__/contract.ts.
 */
export interface VehicleLink {
  connect(vehicleId: string): Promise<void>
  disconnect(): Promise<void>

  onState(cb: (s: VehicleState) => void): Unsubscribe
  onLinkStatus(cb: (s: LinkStatus) => void): Unsubscribe
  /** status text, failsafe, mode change, RC override */
  onEvent(cb: (e: VehicleEvent) => void): Unsubscribe

  send(cmd: Command): Promise<CommandResult>
  /** Resolves after the vehicle verifies the upload. */
  uploadMission(m: Mission): Promise<CommandResult>
  downloadMission(): Promise<Mission | null>

  /** The UI just attaches this to a <video>. */
  getVideoStream(): MediaStream | null
  onVideoStream(cb: (s: MediaStream | null) => void): Unsubscribe
}
