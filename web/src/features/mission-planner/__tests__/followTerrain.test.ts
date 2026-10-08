import { describe, expect, it } from 'vitest'
import { buildMissionProfile, fromLocalEastNorthM, sampleProfile, terrainClearance, type GeoPoint, type Mission } from '../../../domain'
import type { TerrainService } from '../../../services'
import { followTerrain } from '../followTerrain'

const HOME = { lat: -37.861, lon: 145.062 }
const HOME_GROUND = 100
const at = (northM: number) => fromLocalEastNorthM(HOME, 0, northM)
const northOf = (p: GeoPoint) => (p.lat - HOME.lat) * 111_320

/** Flat at 100 m AMSL with an 80 m ridge 500 m north of home. */
const ridge: TerrainService = {
  description: 'test ridge',
  elevationsM: (points) =>
    Promise.resolve(points.map((p) => HOME_GROUND + 80 * Math.exp(-(((northOf(p) - 500) / 100) ** 2)))),
}

const mission: Mission = {
  id: 'm',
  name: 'm',
  createdAt: 0,
  updatedAt: 0,
  items: [{ type: 'vtolTakeoff', altM: 30 }, { type: 'waypoint', ...at(1000), altM: 40 }, { type: 'returnToLaunch' }],
}

describe('followTerrain', () => {
  it('holds the height over a ridge between waypoints by adding one', async () => {
    const result = await followTerrain(ridge, mission, HOME, 60)
    expect(result.heightsChanged).toBe(2) // takeoff and the waypoint
    expect(result.waypointsAdded).toBeGreaterThanOrEqual(1)
    expect(result.capped).toBe(false)

    // Every outbound leg now clears 60 m, give or take the tolerance.
    const profile = buildMissionProfile({ ...mission, items: result.items }, HOME)
    const samples = sampleProfile(profile, 20)
    const ground = await ridge.elevationsM(samples.map((s) => s.point))
    const clearance = terrainClearance(samples, ground, [], [], HOME_GROUND)
    const outbound = clearance.samples.filter((s) => result.items[(s.fromItemIndex ?? 0) + 1]?.type !== 'returnToLaunch')
    expect(Math.min(...outbound.map((s) => s.clearanceM!))).toBeGreaterThan(50)
  })

  it('reports the RTL leg it cannot raise', async () => {
    const result = await followTerrain(ridge, mission, HOME, 60)
    // RTL flies home over the ridge at RTL_ALTITUDE (60 m): only ~0 m clear.
    expect(result.rtlClearanceM).not.toBeNull()
    expect(result.rtlClearanceM!).toBeLessThan(10)
  })

  it('fails without ground data at home', async () => {
    const none: TerrainService = { description: 'none', elevationsM: (p) => Promise.resolve(p.map(() => null)) }
    await expect(followTerrain(none, mission, HOME, 60)).rejects.toThrow('home')
  })
})
