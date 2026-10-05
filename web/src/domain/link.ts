export type LinkState = 'disconnected' | 'connecting' | 'connected' | 'degraded'
export type LinkPath = 'direct' | 'relayed' | 'unknown'

export interface LinkStatus {
  state: LinkState
  path?: LinkPath
  rttMs?: number
  videoKbps?: number
  /** epoch ms */
  lastTelemetryAt?: number
}
