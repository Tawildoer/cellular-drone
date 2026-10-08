import type { LinkStatus } from '../domain'

export const LINK_HISTORY_WINDOW_MS = 60_000
/** Four a second, so the HUD's strength line moves smoothly and a drop
 * shows within a quarter second. WebRtcLink measures about once a second,
 * so between its polls the points repeat; MockLink reports every tick. */
export const LINK_SAMPLE_INTERVAL_MS = 250

/** One moment of link quality. A field left undefined (link down, or a link
 * that doesn't measure it) shows as a gap in the sparklines, not a zero. */
export interface LinkHistoryPoint {
  at: number
  /** Whether the link was connected (or degraded) at this moment. */
  up: boolean
  rttMs?: number
  videoKbps?: number
  videoFps?: number
  packetLossPct?: number
  jitterMs?: number
}

/**
 * Appends at most one point per LINK_SAMPLE_INTERVAL_MS, whatever rate the
 * link reports at, and drops points older than the window.
 */
export function appendLinkHistory(history: LinkHistoryPoint[], status: LinkStatus, now: number): LinkHistoryPoint[] {
  const last = history.at(-1)
  if (last && now - last.at < LINK_SAMPLE_INTERVAL_MS * 0.8) return history

  const up = status.state === 'connected' || status.state === 'degraded'
  const point: LinkHistoryPoint = up
    ? {
        at: now,
        up: true,
        rttMs: status.rttMs,
        videoKbps: status.videoKbps,
        videoFps: status.videoFps,
        packetLossPct: status.packetLossPct,
        jitterMs: status.jitterMs,
      }
    : { at: now, up: false }

  return [...history.filter((p) => now - p.at < LINK_HISTORY_WINDOW_MS), point]
}
