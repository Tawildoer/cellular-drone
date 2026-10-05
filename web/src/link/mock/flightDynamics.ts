import { fromLocalEastNorthM, projectOntoSegment } from '../../domain/geo'
import type { GeoPoint } from '../../domain/mission'

/** Blowing from `directionDeg` (meteorological convention — matches how
 * pilots/ATC describe wind), at `speedMps`. Zero speed = calm. */
export interface Wind {
  speedMps: number
  directionDeg: number
}

export const CALM_WIND: Wind = { speedMps: 0, directionDeg: 0 }

export const DEFAULT_MAX_TURN_RATE_DEG_PER_S = 20
/** "Cleared" radius for a mission item — a genuine 3D (horizontal + vertical)
 * distance, so an aircraft that's horizontally near a waypoint but still well
 * off in altitude is not considered to have reached it (see sim.ts's cruise
 * case, which folds vertical distance in before comparing against this). */
export const DEFAULT_ACCEPT_RADIUS_M = 20

const METERS_PER_DEG_LAT = 111_320

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Shortest signed angular difference `b - a`, in (-180, 180]. */
export function angleDiffDeg(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180
}

/**
 * Turns `headingDeg` toward `desiredHeadingDeg` by at most
 * `maxTurnRateDegPerS * dtS`, via the shorter rotational direction — this is
 * what gives the aircraft a real turning radius instead of snapping its nose
 * straight at the target every tick.
 */
export function turnToward(headingDeg: number, desiredHeadingDeg: number, maxTurnRateDegPerS: number, dtS: number): number {
  const diff = angleDiffDeg(headingDeg, desiredHeadingDeg)
  const maxStep = maxTurnRateDegPerS * dtS
  const step = Math.max(-maxStep, Math.min(maxStep, diff))
  return (headingDeg + step + 360) % 360
}

/** Random walk on heading — small per-tick jitter, independent of dtS size
 * (scaled by sqrt(dtS) so accumulated drift over a fixed time span doesn't
 * depend on tick rate), simulating turbulence / control imprecision. Pass a
 * seeded `rng` for deterministic tests; defaults to `Math.random`. */
export function applyHeadingNoise(headingDeg: number, magnitudeDegPerS: number, dtS: number, rng: () => number = Math.random): number {
  if (magnitudeDegPerS <= 0) return headingDeg
  const jitter = (rng() * 2 - 1) * magnitudeDegPerS * Math.sqrt(dtS)
  return (headingDeg + jitter + 360) % 360
}

/**
 * Ground velocity (east/north, m/s) = the airspeed vector along `headingDeg`
 * plus the wind vector. `wind.directionDeg` is where the wind blows *from*,
 * so its push on the aircraft is in the opposite direction.
 */
export function groundVelocityMps(headingDeg: number, airspeedMps: number, wind: Wind): { eastMps: number; northMps: number } {
  const headingRad = toRad(headingDeg)
  const airEast = airspeedMps * Math.sin(headingRad)
  const airNorth = airspeedMps * Math.cos(headingRad)

  const windTowardRad = toRad(wind.directionDeg + 180)
  const windEast = wind.speedMps * Math.sin(windTowardRad)
  const windNorth = wind.speedMps * Math.cos(windTowardRad)

  return { eastMps: airEast + windEast, northMps: airNorth + windNorth }
}

/** Steps a 1D value toward `target` by at most `maxStep`, in whichever
 * direction is needed — used for climbing/descending toward a waypoint's
 * altitude over a leg, the vertical counterpart to `turnToward`. */
export function stepToward1D(current: number, target: number, maxStep: number): number {
  const diff = target - current
  const step = Math.max(-maxStep, Math.min(maxStep, diff))
  return current + step
}

/** Integrates a position forward by a constant east/north ground velocity over dtS. */
export function stepPosition(position: GeoPoint, eastMps: number, northMps: number, dtS: number): GeoPoint {
  const dLatPerM = 1 / METERS_PER_DEG_LAT
  const dLonPerM = 1 / (METERS_PER_DEG_LAT * Math.cos(toRad(position.lat)))
  return {
    lat: position.lat + northMps * dtS * dLatPerM,
    lon: position.lon + eastMps * dtS * dLonPerM,
  }
}

export const DEFAULT_LOOK_AHEAD_M = 100

/**
 * Classic L1/"pure pursuit" path following (same idea ArduPilot's L1
 * controller uses): instead of aiming straight at the final waypoint, aim at
 * the point on the prescribed `from -> to` line that is exactly
 * `lookAheadM` away from the aircraft's *current* position. That point is
 * found via the projection of `position` onto the line (its foot of
 * perpendicular) plus, by Pythagoras, `sqrt(lookAheadM² - crossTrackM²)`
 * further along the line — so an aircraft that's drifted off the line (e.g.
 * coming out of a turn) re-converges onto it rather than cutting straight
 * for `to` and never recovering the prescribed track. Clamped to `to` at the
 * far end, and to the foot of perpendicular when off-track by more than
 * `lookAheadM` (no real look-ahead point exists yet — just aim back at the line).
 */
export function lookAheadPoint(position: GeoPoint, from: GeoPoint, to: GeoPoint, lookAheadM: number): GeoPoint {
  const proj = projectOntoSegment(position, from, to)
  if (!proj) return to

  const aheadM = Math.sqrt(Math.max(0, lookAheadM * lookAheadM - proj.crossTrackM * proj.crossTrackM))
  const carrotDistAlong = Math.min(proj.segLen, proj.closestDistAlong + aheadM)

  return fromLocalEastNorthM(from, proj.dirEast * carrotDistAlong, proj.dirNorth * carrotDistAlong)
}
