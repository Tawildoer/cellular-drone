import type { MissionItem } from './mission'
import type { TerrainClearance } from './missionProfile'

/**
 * "Fly X m above the ground", done by the planner (ADR-0021): it sets
 * ordinary above-home heights and adds waypoints, so the flight controller
 * flies it like any other mission and needs no terrain data of its own.
 * Two steps, both pure; the planner looks the ground up between them.
 */

/** A leg may dip this far under the target before a waypoint is added:
 * less than the terrain grid can promise anyway. */
export const TERRAIN_FOLLOW_TOLERANCE_M = 3

/**
 * Step 1: every waypoint and loiter at `aboveGroundM` over the ground under
 * it. `groundM[i]` is item i's ground relative to the ground at home (for a
 * loiter, the highest ground under its circle); null leaves the item as it
 * is. The takeoff climbs to `aboveGroundM` (it's at home, the zero), so the
 * first leg starts high enough. Landing and RTL have no height to set.
 */
export function setHeightsAboveGround(items: MissionItem[], groundM: (number | null)[], aboveGroundM: number): MissionItem[] {
  return items.map((item, i) => {
    if (item.type === 'vtolTakeoff') return { ...item, altM: Math.round(aboveGroundM) }
    const ground = groundM[i]
    if ((item.type !== 'waypoint' && item.type !== 'loiter') || ground === null || ground === undefined) return item
    return { ...item, altM: Math.round(ground + aboveGroundM) }
  })
}

/**
 * Step 2: where a leg passes lowest under `aboveGroundM` (a ridge between
 * two waypoints: heights change evenly along a leg), add a waypoint at
 * `aboveGroundM` over that spot. Null when every leg is high enough, or the
 * only low legs can't be fixed here: the RTL leg flies at the flight
 * controller's RTL_ALTITUDE whatever the plan says.
 */
export function insertTerrainWaypoint(
  items: MissionItem[],
  clearance: TerrainClearance,
  aboveGroundM: number,
  toleranceM = TERRAIN_FOLLOW_TOLERANCE_M,
): MissionItem[] | null {
  let worst: TerrainClearance['samples'][number] | null = null
  for (const sample of clearance.samples) {
    if (sample.clearanceM === null || sample.groundM === null || sample.fromItemIndex === null) continue
    if (sample.clearanceM >= aboveGroundM - toleranceM) continue
    if (items[sample.fromItemIndex + 1]?.type === 'returnToLaunch') continue
    if (!worst || sample.clearanceM < worst.clearanceM!) worst = sample
  }
  if (!worst) return null
  const at = worst.fromItemIndex! + 1
  const waypoint: MissionItem = {
    type: 'waypoint',
    lat: worst.point.lat,
    lon: worst.point.lon,
    altM: Math.round(worst.groundM! + aboveGroundM),
  }
  return [...items.slice(0, at), waypoint, ...items.slice(at)]
}

/** The lowest clearance on the RTL leg, which the planner can't change
 * (RTL_ALTITUDE is a flight controller parameter). Null without one. */
export function rtlLegLowestClearanceM(items: MissionItem[], clearance: TerrainClearance): number | null {
  let lowest: number | null = null
  for (const sample of clearance.samples) {
    if (sample.clearanceM === null || sample.fromItemIndex === null) continue
    if (items[sample.fromItemIndex + 1]?.type !== 'returnToLaunch') continue
    if (lowest === null || sample.clearanceM < lowest) lowest = sample.clearanceM
  }
  return lowest
}
