import { itemPosition, type GeoPoint, type Mission } from './mission'
import { buildMissionProfile, returnHomeEstimate, SITL_PERFORMANCE, type FlightPerformance, type ProfileStart } from './missionProfile'
import type { WindVector } from './weather'

/** Battery kept back beyond the trip home: the VTOL landing's margin and the
 * unexpected (headwind, a go-around). ADR-0025. */
export const BATTERY_RETURN_RESERVE_PCT = 15

/** How quickly the measured drain rate follows changes (seconds). */
const DRAIN_SMOOTHING_S = 30
/** A sample faster than this is a jump in the reading, not drain. */
const MAX_DRAIN_PCT_PER_S = 1

/**
 * Battery the aircraft needs to fly home and land from where it is: the
 * RTL estimate's duration at the drain rate measured so far, plus the
 * reserve. At or below it, the vehicle returns home by itself (ADR-0025).
 */
export function batteryNeededToReturnPct(returnDurationS: number, drainPctPerS: number, reservePct = BATTERY_RETURN_RESERVE_PCT): number {
  return returnDurationS * Math.max(0, drainPctPerS) + reservePct
}

/** The drain rate (% per second), smoothed: one reading's change folded into
 * the running average. Null before there's a rate to smooth. */
export function updateDrainRate(prevRatePctPerS: number | null, prevPct: number, nowPct: number, dtS: number): number | null {
  if (dtS <= 0) return prevRatePctPerS
  const sample = Math.min(MAX_DRAIN_PCT_PER_S, Math.max(0, (prevPct - nowPct) / dtS))
  if (prevRatePctPerS === null) return sample
  return prevRatePctPerS + (sample - prevRatePctPerS) * (1 - Math.exp(-dtS / DRAIN_SMOOTHING_S))
}

/** Whether a route fits the battery: what it needs (reserve included) against
 * what's there. ADR-0025. */
export interface RouteBattery {
  neededPct: number
  availablePct: number
  /** Fits the charge there is now. */
  fits: boolean
  /** Fits a full battery at least. */
  fitsFullBattery: boolean
}

/**
 * The battery a route needs, at the planning drain (`enduranceS`): flying it
 * as the planner estimates (buildMissionProfile, from `from` or a takeoff at
 * home), then home if it doesn't end there or in a landing, plus the reserve.
 * Laps of a clock-mode loiter count as their minimum. With a `wind`, legs
 * are timed at their ground speed (ADR-0026).
 */
export function routeBattery(
  mission: Mission,
  home: GeoPoint,
  availablePct: number,
  options: { from?: ProfileStart; wind?: WindVector | null; perf?: FlightPerformance } = {},
): RouteBattery {
  const { from, wind, perf = SITL_PERFORMANCE } = options
  const profile = buildMissionProfile(mission, home, perf, from, undefined, wind)
  let durationS = profile.durationS
  const last = mission.items.at(-1)
  if (last && last.type !== 'returnToLaunch' && last.type !== 'vtolLand') {
    const point = itemPosition(last)
    const end = profile.vertices.at(-1)
    if (point) durationS += returnHomeEstimate({ point, altM: end?.altM ?? perf.rtlAltM, fixedWing: true }, home, perf, wind).durationS
  } else if (!last && from) {
    durationS += returnHomeEstimate(from, home, perf, wind).durationS
  }
  const neededPct = batteryNeededToReturnPct(durationS, 100 / perf.enduranceS)
  return { neededPct, availablePct, fits: neededPct <= availablePct, fitsFullBattery: neededPct <= 100 }
}
