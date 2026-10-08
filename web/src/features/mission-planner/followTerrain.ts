import {
  buildMissionProfile,
  insertTerrainWaypoint,
  itemPosition,
  loiterRingPoints,
  rtlLegLowestClearanceM,
  sampleProfile,
  setHeightsAboveGround,
  terrainClearance,
  type GeoPoint,
  type Mission,
  type MissionItem,
} from '../../domain'
import type { TerrainService } from '../../services'

/** Enough for real ridges; more means the terrain is too rough for one height. */
export const MAX_ADDED_WAYPOINTS = 25
const SPACING_M = 30
const MAX_SAMPLES = 400

export interface FollowTerrainResult {
  items: MissionItem[]
  heightsChanged: number
  waypointsAdded: number
  /** Stopped at MAX_ADDED_WAYPOINTS with legs still low. */
  capped: boolean
  /** Lowest clearance on the RTL leg, which flies at RTL_ALTITUDE. */
  rtlClearanceM: number | null
}

/**
 * Sets the mission's heights to `aboveGroundM` over the terrain and adds
 * waypoints over ridges between them (domain/terrainFollow.ts). Fails if the
 * ground at home can't be looked up: every height is measured from it.
 */
export async function followTerrain(
  terrain: TerrainService,
  mission: Mission,
  home: GeoPoint,
  aboveGroundM: number,
): Promise<FollowTerrainResult> {
  const [homeGround] = await terrain.elevationsM([home])
  if (homeGround === null || homeGround === undefined) throw new Error('No terrain data at home')

  // Step 1: each waypoint and loiter over its own ground.
  const itemGround = await Promise.all(
    mission.items.map(async (item): Promise<number | null> => {
      const point = itemPosition(item)
      if (!point || (item.type !== 'waypoint' && item.type !== 'loiter')) return null
      const points =
        item.type === 'loiter'
          ? [point, ...loiterRingPoints({ itemIndex: 0, distanceM: 0, center: point, radiusM: item.radiusM, altM: item.altM })]
          : [point]
      const known = (await terrain.elevationsM(points)).filter((m): m is number => m !== null)
      return known.length === 0 ? null : Math.max(...known) - homeGround
    }),
  )
  let items = setHeightsAboveGround(mission.items, itemGround, aboveGroundM)
  const heightsChanged = items.filter((item, i) => item !== mission.items[i]).length

  // Step 2: waypoints over the ridges, worst first, until every leg clears.
  let waypointsAdded = 0
  for (;;) {
    const profile = buildMissionProfile({ ...mission, items }, home)
    const samples = sampleProfile(profile, Math.max(SPACING_M, profile.routeDistanceM / MAX_SAMPLES))
    const ground = await terrain.elevationsM(samples.map((s) => s.point))
    const clearance = terrainClearance(samples, ground, [], [], homeGround)
    const next = waypointsAdded < MAX_ADDED_WAYPOINTS ? insertTerrainWaypoint(items, clearance, aboveGroundM) : null
    if (!next) {
      const capped = waypointsAdded >= MAX_ADDED_WAYPOINTS && insertTerrainWaypoint(items, clearance, aboveGroundM) !== null
      return { items, heightsChanged, waypointsAdded, capped, rtlClearanceM: rtlLegLowestClearanceM(items, clearance) }
    }
    items = next
    waypointsAdded++
  }
}
