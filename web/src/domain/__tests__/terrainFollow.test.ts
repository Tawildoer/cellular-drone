import { describe, expect, it } from 'vitest'
import type { MissionItem } from '../mission'
import type { ClearanceSample, TerrainClearance } from '../missionProfile'
import { insertTerrainWaypoint, rtlLegLowestClearanceM, setHeightsAboveGround } from '../terrainFollow'

const items: MissionItem[] = [
  { type: 'vtolTakeoff', altM: 30 },
  { type: 'waypoint', lat: 1, lon: 1, altM: 50 },
  { type: 'loiter', lat: 2, lon: 2, altM: 50, radiusM: 80, turns: 1 },
  { type: 'returnToLaunch' },
]

function sample(fromItemIndex: number, distanceM: number, altM: number, groundM: number | null): ClearanceSample {
  return {
    fromItemIndex,
    distanceM,
    altM,
    point: { lat: distanceM, lon: distanceM },
    groundM,
    clearanceM: groundM === null ? null : altM - groundM,
  }
}

function clearance(samples: ClearanceSample[]): TerrainClearance {
  return { samples, loiters: [], lowest: null, incomplete: false }
}

describe('setHeightsAboveGround', () => {
  it('puts the takeoff, waypoints and loiters that high over their ground', () => {
    const out = setHeightsAboveGround(items, [null, 25.4, 40, null], 60)
    expect(out.map((i) => ('altM' in i ? i.altM : null))).toEqual([60, 85, 100, null])
  })

  it('leaves an item with no ground data as it is', () => {
    expect(setHeightsAboveGround(items, [null, null, null, null], 60)[1]).toBe(items[1])
  })
})

describe('insertTerrainWaypoint', () => {
  it('adds a waypoint over the lowest point of a low leg, after its start', () => {
    const out = insertTerrainWaypoint(
      items,
      clearance([sample(0, 0, 60, 0), sample(0, 100, 60, 30), sample(0, 200, 60, 45), sample(1, 300, 60, 0)]),
      60,
    )
    expect(out).toHaveLength(items.length + 1)
    expect(out![1]).toEqual({ type: 'waypoint', lat: 200, lon: 200, altM: 105 })
    expect(out![2]).toBe(items[1])
  })

  it('accepts a leg within the tolerance, and returns null', () => {
    expect(insertTerrainWaypoint(items, clearance([sample(0, 100, 60, 2)]), 60)).toBeNull()
  })

  it("can't fix the RTL leg, but reports it", () => {
    const low = clearance([sample(2, 500, 60, 50)]) // item 3 is the RTL
    expect(insertTerrainWaypoint(items, low, 60)).toBeNull()
    expect(rtlLegLowestClearanceM(items, low)).toBe(10)
  })
})
