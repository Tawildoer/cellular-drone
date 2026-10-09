import { fromLocalEastNorthM, haversineDistanceM } from './geo'
import { itemPosition, type GeoPoint, type Mission } from './mission'

/**
 * How the aircraft flies, for the planner's estimates. These are ArduPlane
 * SITL figures (ADR-0017: SITL is the reference), measured from a flight log
 * on 2026-10-08, until the real airframe is tuned in Phase 3. Each names the
 * ArduPilot parameter it stands for.
 */
export interface FlightPerformance {
  /** `AIRSPEED_CRUISE`: SITL's QuadPlane cruises at 25 m/s. */
  cruiseMps: number
  /** VTOL takeoff climb: 2.5 m/s in SITL. */
  vtolClimbMps: number
  /** VTOL landing descent down to `landFinalAltM`: 1.5 m/s in SITL. */
  vtolDescentMps: number
  /** `Q_LAND_FINAL_ALT`: below this the descent slows to `landFinalMps`. */
  landFinalAltM: number
  /** `Q_LAND_SPEED`: 0.5 m/s. */
  landFinalMps: number
  /** Hover to fixed-wing, on the first leg after takeoff: about 10 s. */
  transitionS: number
  /** Airbrake and back to hover before a VTOL landing: about 10 s. */
  backTransitionS: number
  /** `RTL_ALTITUDE`: the height ArduPlane flies home at (`sim/params`). */
  rtlAltM: number
}

export const SITL_PERFORMANCE: FlightPerformance = {
  cruiseMps: 25,
  vtolClimbMps: 2.5,
  vtolDescentMps: 1.5,
  landFinalAltM: 6,
  landFinalMps: 0.5,
  transitionS: 10,
  backTransitionS: 10,
  rtlAltM: 60,
}

/** Below this height above the terrain the planner warns. Terrain data has
 * no trees, buildings or masts, so this is a margin, not a guarantee. */
export const TERRAIN_CLEARANCE_WARN_M = 30

/** A point on the planned route seen side-on: `distanceM` along the ground
 * from home, `altM` above home (the mission's altitude frame, docs/MAVLINK.md). */
export interface ProfileVertex {
  distanceM: number
  altM: number
  point: GeoPoint
  /** The mission item this point is, or null (home). */
  itemIndex: number | null
}

export interface ProfileLoiter {
  itemIndex: number
  /** Where along the route it is. */
  distanceM: number
  center: GeoPoint
  radiusM: number
  altM: number
}

export interface MissionProfile {
  vertices: ProfileVertex[]
  loiters: ProfileLoiter[]
  /** Along the route, as drawn on the profile's x axis (no loiter laps). */
  routeDistanceM: number
  /** Everything flown, loiter laps included. */
  flownDistanceM: number
  durationS: number
  /** A clock-mode loiter's length depends on when the aircraft gets there,
   * so only its one guaranteed lap is counted: the real flight may be longer. */
  durationIsMinimum: boolean
  maxAltM: number
}

function descentS(altM: number, perf: FlightPerformance): number {
  const finalM = Math.min(altM, perf.landFinalAltM)
  return (altM - finalM) / perf.vtolDescentMps + finalM / perf.landFinalMps
}

/** Where the profile starts: home on the ground by default, or the aircraft
 * where it is now, for what's left of a mission in flight. */
export interface ProfileStart {
  point: GeoPoint
  altM: number
  /** Already in fixed-wing flight, so no transition before the first leg. */
  fixedWing: boolean
}

/**
 * The mission as ArduPlane flies it, side-on, with distance and time
 * estimates (docs/MAVLINK.md):
 * - VTOL takeoff climbs straight up at home; the first leg after it starts
 *   with the transition to fixed-wing.
 * - Between waypoints the altitude changes evenly along the leg (ArduPlane's
 *   glide slope), so the profile joins vertices with straight lines.
 * - A VTOL landing flies to the land point at the height it has, then
 *   back-transitions and descends vertically.
 * - RTL flies home at `RTL_ALTITUDE`, then lands vertically (`Q_RTL_MODE`).
 * Items after a landing or RTL are never flown and are left out.
 */
export function buildMissionProfile(
  mission: Mission,
  home: GeoPoint,
  perf: FlightPerformance = SITL_PERFORMANCE,
  from?: ProfileStart,
): MissionProfile {
  const start = from ?? { point: home, altM: 0, fixedWing: false }
  const vertices: ProfileVertex[] = [{ distanceM: 0, altM: start.altM, point: start.point, itemIndex: null }]
  const loiters: ProfileLoiter[] = []
  let pos = start.point
  let distanceM = 0
  let flownM = 0
  let altM = start.altM
  let durationS = 0
  let durationIsMinimum = false
  let fixedWing = start.fixedWing

  function flyTo(point: GeoPoint, toAltM: number, itemIndex: number | null) {
    if (!fixedWing) {
      durationS += perf.transitionS
      fixedWing = true
    }
    const legM = haversineDistanceM(pos, point)
    distanceM += legM
    flownM += legM
    durationS += legM / perf.cruiseMps
    pos = point
    altM = toAltM
    vertices.push({ distanceM, altM, point, itemIndex })
  }

  function landHere(itemIndex: number | null) {
    if (fixedWing) durationS += perf.backTransitionS
    durationS += descentS(altM, perf)
    altM = 0
    vertices.push({ distanceM, altM, point: pos, itemIndex })
  }

  for (const [i, item] of mission.items.entries()) {
    if (item.type === 'vtolTakeoff') {
      durationS += Math.max(0, item.altM - altM) / perf.vtolClimbMps
      altM = item.altM
      vertices.push({ distanceM, altM, point: pos, itemIndex: i })
      continue
    }
    if (item.type === 'returnToLaunch') {
      flyTo(home, perf.rtlAltM, i)
      landHere(i)
      break
    }
    const point = itemPosition(item)
    if (!point) continue
    if (item.type === 'vtolLand') {
      flyTo(point, altM, i)
      landHere(i)
      break
    }
    flyTo(point, item.altM, i)
    if (item.type === 'loiter') {
      const clockMode = item.untilUtcMinuteOfDay !== undefined
      const lapsM = (clockMode ? 1 : (item.turns ?? 1)) * 2 * Math.PI * item.radiusM
      flownM += lapsM
      durationS += lapsM / perf.cruiseMps
      durationIsMinimum ||= clockMode
      loiters.push({ itemIndex: i, distanceM, center: point, radiusM: item.radiusM, altM: item.altM })
    }
  }

  return {
    vertices,
    loiters,
    routeDistanceM: distanceM,
    flownDistanceM: flownM,
    durationS,
    durationIsMinimum,
    maxAltM: Math.max(...vertices.map((v) => v.altM)),
  }
}

/** A point along the route to look the terrain up at. */
export interface ProfileSample {
  distanceM: number
  altM: number
  point: GeoPoint
  /** The leg it's on: from this item (null = home) toward the next vertex. */
  fromItemIndex: number | null
}

/**
 * Points every `spacingM` or closer along the horizontal legs, ends
 * included. Vertical parts (takeoff climb, landing descent) are left out:
 * they meet the ground by design, so their clearance means nothing.
 */
export function sampleProfile(profile: MissionProfile, spacingM: number): ProfileSample[] {
  const samples: ProfileSample[] = []
  const { vertices } = profile
  for (let v = 1; v < vertices.length; v++) {
    const a = vertices[v - 1]!
    const b = vertices[v]!
    const legM = b.distanceM - a.distanceM
    if (legM <= 0) continue
    const steps = Math.max(1, Math.ceil(legM / spacingM))
    for (let s = samples.at(-1)?.distanceM === a.distanceM ? 1 : 0; s <= steps; s++) {
      const f = s / steps
      samples.push({
        distanceM: a.distanceM + legM * f,
        altM: a.altM + (b.altM - a.altM) * f,
        point: { lat: a.point.lat + (b.point.lat - a.point.lat) * f, lon: a.point.lon + (b.point.lon - a.point.lon) * f },
        fromItemIndex: a.itemIndex,
      })
    }
  }
  return samples
}

/** Points around a loiter circle, to find the highest ground under it. */
export function loiterRingPoints(loiter: ProfileLoiter, count = 16): GeoPoint[] {
  return Array.from({ length: count }, (_, k) => {
    const angle = (2 * Math.PI * k) / count
    return fromLocalEastNorthM(loiter.center, loiter.radiusM * Math.sin(angle), loiter.radiusM * Math.cos(angle))
  })
}

export interface ClearanceSample extends ProfileSample {
  /** Ground height relative to the ground at home (m); null = no data. */
  groundM: number | null
  /** Planned height above that ground (m); null = no data. */
  clearanceM: number | null
}

export interface LoiterClearance {
  itemIndex: number
  /** Over the highest ground under the circle; null = no data. */
  clearanceM: number | null
}

export interface LowestClearance {
  clearanceM: number
  distanceM: number
  /** The leg or loiter it's on (null = the leg from home). */
  itemIndex: number | null
  onLoiter: boolean
}

export interface TerrainClearance {
  samples: ClearanceSample[]
  loiters: LoiterClearance[]
  lowest: LowestClearance | null
  /** Some points had no terrain data. */
  incomplete: boolean
}

/**
 * Height above the terrain along the route and around each loiter.
 * Elevations are AMSL from one terrain source, and the mission's heights
 * are above home, so the ground at home in the same source is the datum:
 * that keeps the source's own offsets out of the answer.
 */
export function terrainClearance(
  samples: ProfileSample[],
  sampleGroundAmslM: (number | null)[],
  loiters: ProfileLoiter[],
  loiterRingGroundAmslM: (number | null)[][],
  homeGroundAmslM: number,
): TerrainClearance {
  let lowest: LowestClearance | null = null
  let incomplete = false
  const consider = (candidate: LowestClearance) => {
    if (!lowest || candidate.clearanceM < lowest.clearanceM) lowest = candidate
  }

  const clearanceSamples = samples.map((sample, i): ClearanceSample => {
    const amsl = sampleGroundAmslM[i] ?? null
    if (amsl === null) {
      incomplete = true
      return { ...sample, groundM: null, clearanceM: null }
    }
    const groundM = amsl - homeGroundAmslM
    const clearanceM = sample.altM - groundM
    consider({ clearanceM, distanceM: sample.distanceM, itemIndex: sample.fromItemIndex, onLoiter: false })
    return { ...sample, groundM, clearanceM }
  })

  const loiterClearances = loiters.map((loiter, i): LoiterClearance => {
    const ring = loiterRingGroundAmslM[i] ?? []
    const known = ring.filter((m): m is number => m !== null)
    if (known.length < ring.length || known.length === 0) incomplete = true
    if (known.length === 0) return { itemIndex: loiter.itemIndex, clearanceM: null }
    const clearanceM = loiter.altM - (Math.max(...known) - homeGroundAmslM)
    consider({ clearanceM, distanceM: loiter.distanceM, itemIndex: loiter.itemIndex, onLoiter: true })
    return { itemIndex: loiter.itemIndex, clearanceM }
  })

  return { samples: clearanceSamples, loiters: loiterClearances, lowest, incomplete }
}

/** What's left of a mission in flight, at the planner's ArduPlane figures. */
export interface MissionRemaining {
  /** The item being flown to (`missionProgress.currentIndex`). */
  currentIndex: number
  /** Straight-line distance to it; 0 for a takeoff (that's a climb). */
  toCurrentM: number
  /** Everything still to fly, loiter laps included. */
  remainingM: number
  remainingS: number
  /** A clock-mode loiter is still ahead: the real time may be longer. */
  isMinimum: boolean
}

/**
 * From the aircraft's position to the end of the mission, starting with the
 * item it's flying to. A loiter it's already circling counts its laps in
 * full, so near one the estimate runs a little long.
 */
export function remainingMission(
  mission: Mission,
  currentIndex: number,
  aircraft: ProfileStart,
  home: GeoPoint,
  perf: FlightPerformance = SITL_PERFORMANCE,
): MissionRemaining | null {
  if (currentIndex < 0 || currentIndex >= mission.items.length) return null
  const rest = { ...mission, items: mission.items.slice(currentIndex) }
  const profile = buildMissionProfile(rest, home, perf, aircraft)
  const first = profile.vertices[1]
  return {
    currentIndex,
    toCurrentM: first ? first.distanceM : 0,
    remainingM: profile.flownDistanceM,
    remainingS: profile.durationS,
    isMinimum: profile.durationIsMinimum,
  }
}

/** Straight home from where the aircraft is, as RTL flies it: at
 * RTL_ALTITUDE, then a vertical landing. */
export function returnHomeEstimate(
  aircraft: ProfileStart,
  home: GeoPoint,
  perf: FlightPerformance = SITL_PERFORMANCE,
): { distanceM: number; durationS: number } {
  const rtl: Mission = { id: 'rtl', name: 'rtl', createdAt: 0, updatedAt: 0, items: [{ type: 'returnToLaunch' }] }
  const profile = buildMissionProfile(rtl, home, perf, aircraft)
  return { distanceM: profile.routeDistanceM, durationS: profile.durationS }
}

