/**
 * What the mock link reports about itself, so the HUD's link-quality views
 * have something realistic to show: an LTE-ish round-trip time that wanders
 * around ~70 ms with an occasional spike (a cell handover, a busy moment),
 * a video frame rate that sags during spikes, and a little packet loss.
 * Reported numbers only: the delay the mock actually adds is still the
 * `latencyMs` fault.
 */
export interface LinkConditions {
  rttMs: number
  videoFps: number
  packetLossPct: number
}

export const INITIAL_LINK_CONDITIONS: LinkConditions = { rttMs: 70, videoFps: 30, packetLossPct: 0.2 }

const RTT_MEAN_MS = 70
const RTT_SPREAD_MS = 25
/** How fast RTT returns to its mean (per second). */
const RTT_PULL = 0.6
/** Chance per second of a latency spike. */
const SPIKE_PER_S = 0.04
const LOSS_MEAN_PCT = 0.3

function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-9)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

/** One step of `dtS` seconds: each value drifts back toward its mean with
 * some noise (mean-reverting), plus the occasional RTT spike. */
export function nextLinkConditions(prev: LinkConditions, dtS: number, rng: () => number = Math.random): LinkConditions {
  let rttMs =
    prev.rttMs + (RTT_MEAN_MS - prev.rttMs) * RTT_PULL * dtS + RTT_SPREAD_MS * Math.sqrt(dtS) * gaussian(rng)
  if (rng() < SPIKE_PER_S * dtS) rttMs += 150 + rng() * 250
  rttMs = Math.min(1500, Math.max(25, rttMs))

  // Frames sag as latency climbs past ~150 ms (the same stall makes both worse).
  const sag = Math.max(0, (rttMs - 150) / 25)
  const videoFps = Math.min(30, Math.max(5, 30 - sag + 0.5 * gaussian(rng)))

  const packetLossPct = Math.min(
    15,
    Math.max(0, prev.packetLossPct + (LOSS_MEAN_PCT + sag * 0.3 - prev.packetLossPct) * dtS + 0.2 * Math.sqrt(dtS) * gaussian(rng)),
  )
  return { rttMs, videoFps, packetLossPct }
}
