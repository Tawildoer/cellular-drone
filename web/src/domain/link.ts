export type LinkState = 'disconnected' | 'connecting' | 'connected' | 'degraded'
export type LinkPath = 'direct' | 'relayed' | 'unknown'

export interface LinkStatus {
  state: LinkState
  path?: LinkPath
  rttMs?: number
  videoKbps?: number
  /** epoch ms */
  lastTelemetryAt?: number
  /** IP version of the path in use. */
  ipVersion?: 4 | 6
  /** Which kinds of ICE candidate the selected path joins, e.g. "host → srflx". */
  pairKinds?: string
  videoFps?: number
  /** Share of video packets lost over the last sample interval, 0–100. */
  packetLossPct?: number
  jitterMs?: number
  /** Cumulative since the video started. */
  videoFreezeCount?: number
  videoFreezeSeconds?: number
}
