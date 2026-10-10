/**
 * What the mock link reports about itself, so the HUD's link-quality views
 * have something realistic to show: an LTE-ish round-trip time that wanders
 * around ~70 ms with an occasional spike (a cell handover, a busy moment),
 * a video frame rate that sags during spikes, and a little packet loss.
 * All of it gets worse as the simulated modem's SINR falls (cellSignal.ts),
 * as a real LTE link's retransmissions and lower data rates make it.
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
/** Below this SINR (dB) the link starts to suffer: per dB short of it, the
 * mean RTT and loss rise and spikes come more often. */
const SINR_COMFORT_DB = 5
const RTT_MS_PER_SINR_DB = 15
const LOSS_PCT_PER_SINR_DB = 0.25

function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-9)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

/** One step of `dtS` seconds: each value drifts back toward its mean with
 * some noise (mean-reverting), plus the occasional RTT spike. `sinrDb`,
 * when known, sets how poor the means are. */
export function nextLinkConditions(prev: LinkConditions, dtS: number, rng: () => number = Math.random, sinrDb?: number): LinkConditions {
  const short = sinrDb === undefined ? 0 : Math.max(0, SINR_COMFORT_DB - sinrDb)
  const rttMean = RTT_MEAN_MS + short * RTT_MS_PER_SINR_DB
  let rttMs =
    prev.rttMs + (rttMean - prev.rttMs) * RTT_PULL * dtS + RTT_SPREAD_MS * Math.sqrt(dtS) * gaussian(rng)
  if (rng() < SPIKE_PER_S * (1 + short / 3) * dtS) rttMs += 150 + rng() * 250
  rttMs = Math.min(1500, Math.max(25, rttMs))

  // Frames sag as latency climbs past ~150 ms (the same stall makes both worse).
  const sag = Math.max(0, (rttMs - 150) / 25)
  const videoFps = Math.min(30, Math.max(5, 30 - sag + 0.5 * gaussian(rng)))

  const packetLossPct = Math.min(
    15,
    Math.max(0, prev.packetLossPct + (LOSS_MEAN_PCT + short * LOSS_PCT_PER_SINR_DB + sag * 0.3 - prev.packetLossPct) * dtS + 0.2 * Math.sqrt(dtS) * gaussian(rng)),
  )
  return { rttMs, videoFps, packetLossPct }
}
