import { describe, expect, it } from 'vitest'
import { validateMission } from '../../../domain'
import type { Mission, MissionItem } from '../../../domain'
import {
  DEFAULT_LOITER_RADIUS_M,
  insertWaypoint,
  removeItemAt,
  setEndingLandAtLastWaypoint,
  setEndingReturnToLaunch,
  localTimeToUtcMinuteOfDay,
  setItemLoiter,
  setLoiterLaps,
  setLoiterUntil,
  skeletonItems,
  updateItemAltitude,
  updateItemRadius,
  utcMinuteOfDayToLocalTime,
} from '../missionEdit'

function missionWith(items: MissionItem[]): Mission {
  return { id: 'm1', name: 'test', items, createdAt: 0, updatedAt: 0 }
}

describe('skeletonItems', () => {
  it('is already a valid mission on its own', () => {
    expect(validateMission(missionWith(skeletonItems())).valid).toBe(true)
  })
})

describe('insertWaypoint', () => {
  it('inserts between takeoff and the ending on a fresh skeleton', () => {
    const items = insertWaypoint(skeletonItems(), { lat: 1, lon: 2 })
    expect(items.map((i) => i.type)).toEqual(['vtolTakeoff', 'waypoint', 'returnToLaunch'])
    expect(items[1]).toMatchObject({ lat: 1, lon: 2, altM: 50 })
  })

  it('appends the mission remains valid after multiple inserts', () => {
    let items = skeletonItems()
    items = insertWaypoint(items, { lat: 1, lon: 1 })
    items = insertWaypoint(items, { lat: 2, lon: 2 })
    items = insertWaypoint(items, { lat: 3, lon: 3 })

    expect(items.map((i) => i.type)).toEqual(['vtolTakeoff', 'waypoint', 'waypoint', 'waypoint', 'returnToLaunch'])
    expect(validateMission(missionWith(items)).valid).toBe(true)
    // New waypoints insert immediately before the ending, preserving tap order.
    expect(items[1]).toMatchObject({ lat: 1, lon: 1 })
    expect(items[2]).toMatchObject({ lat: 2, lon: 2 })
    expect(items[3]).toMatchObject({ lat: 3, lon: 3 })
  })

  it('accepts a custom altitude', () => {
    const items = insertWaypoint(skeletonItems(), { lat: 1, lon: 2 }, 80)
    expect(items[1]).toMatchObject({ altM: 80 })
  })
})

describe('removeItemAt', () => {
  it('removes exactly the targeted item', () => {
    const items = insertWaypoint(skeletonItems(), { lat: 1, lon: 1 })
    const next = removeItemAt(items, 1)
    expect(next.map((i) => i.type)).toEqual(['vtolTakeoff', 'returnToLaunch'])
  })
})

describe('updateItemAltitude', () => {
  it('updates altitude on altitude-bearing item types', () => {
    const items = skeletonItems()
    const next = updateItemAltitude(items, 0, 75)
    expect(next[0]).toMatchObject({ type: 'vtolTakeoff', altM: 75 })
  })

  it('leaves non-altitude items (e.g. returnToLaunch) untouched', () => {
    const items = skeletonItems()
    const next = updateItemAltitude(items, 1, 75)
    expect(next[1]).toEqual({ type: 'returnToLaunch' })
  })
})

describe('setItemLoiter', () => {
  it('converts a waypoint to a loiter, preserving position and altitude', () => {
    const items = insertWaypoint(skeletonItems(), { lat: 5, lon: 6 }, 80)
    const next = setItemLoiter(items, 1, true)
    expect(next[1]).toEqual({ type: 'loiter', lat: 5, lon: 6, altM: 80, radiusM: DEFAULT_LOITER_RADIUS_M, turns: 1 })
  })

  it('converts a loiter back to a plain waypoint', () => {
    const items = insertWaypoint(skeletonItems(), { lat: 5, lon: 6 }, 80)
    const loitered = setItemLoiter(items, 1, true)
    const back = setItemLoiter(loitered, 1, false)
    expect(back[1]).toEqual({ type: 'waypoint', lat: 5, lon: 6, altM: 80 })
  })

  it('is a no-op on items without a position', () => {
    const items = skeletonItems()
    expect(setItemLoiter(items, 0, true)).toEqual(items)
  })

  it('keeps the mission valid through a loiter toggle', () => {
    const items = insertWaypoint(skeletonItems(), { lat: 5, lon: 6 })
    const loitered = setItemLoiter(items, 1, true)
    expect(validateMission(missionWith(loitered)).valid).toBe(true)
  })
})

describe('updateItemRadius', () => {
  it('updates radiusM on a loiter item', () => {
    const items = insertWaypoint(skeletonItems(), { lat: 5, lon: 6 })
    const loitered = setItemLoiter(items, 1, true)
    const next = updateItemRadius(loitered, 1, 120)
    expect(next[1]).toMatchObject({ radiusM: 120 })
  })

  it('leaves non-loiter items untouched', () => {
    const items = insertWaypoint(skeletonItems(), { lat: 5, lon: 6 })
    expect(updateItemRadius(items, 1, 120)).toEqual(items)
  })
})

describe('loiter end mode', () => {
  const loitered = () => setItemLoiter(insertWaypoint(skeletonItems(), { lat: 5, lon: 6 }), 1, true)

  it('switching to clock mode drops the lap count, and back again drops the end time', () => {
    const clock = setLoiterUntil(loitered(), 1, 870)
    expect(clock[1]).toMatchObject({ untilUtcMinuteOfDay: 870 })
    expect(clock[1]).not.toHaveProperty('turns')

    const laps = setLoiterLaps(clock, 1, 4)
    expect(laps[1]).toMatchObject({ turns: 4 })
    expect(laps[1]).not.toHaveProperty('untilUtcMinuteOfDay')
  })

  // Melbourne in AEST: UTC+10, i.e. getTimezoneOffset() = -600.
  const melbourne = { getTimezoneOffset: () => -600 } as Date

  it('converts the local time the operator types to UTC and back', () => {
    expect(localTimeToUtcMinuteOfDay('14:30', melbourne)).toBe(4 * 60 + 30)
    expect(utcMinuteOfDayToLocalTime(4 * 60 + 30, melbourne)).toBe('14:30')
  })

  it('wraps across midnight in the conversion', () => {
    expect(localTimeToUtcMinuteOfDay('08:00', melbourne)).toBe(22 * 60)
    expect(utcMinuteOfDayToLocalTime(22 * 60, melbourne)).toBe('08:00')
  })

  it('rejects malformed times', () => {
    expect(localTimeToUtcMinuteOfDay('', melbourne)).toBeNull()
  })
})

describe('setEndingReturnToLaunch / setEndingLandAtLastWaypoint', () => {
  it('switches the ending to land at the last waypoint', () => {
    const items = insertWaypoint(skeletonItems(), { lat: 5, lon: 6 })
    const next = setEndingLandAtLastWaypoint(items)
    expect(next[next.length - 1]).toEqual({ type: 'vtolLand', lat: 5, lon: 6 })
  })

  it('is a no-op with no waypoints to land at', () => {
    const items = skeletonItems()
    expect(setEndingLandAtLastWaypoint(items)).toEqual(items)
  })

  it('switches back to return-to-launch', () => {
    const items = insertWaypoint(skeletonItems(), { lat: 5, lon: 6 })
    const landed = setEndingLandAtLastWaypoint(items)
    const back = setEndingReturnToLaunch(landed)
    expect(back[back.length - 1]).toEqual({ type: 'returnToLaunch' })
  })

  it('keeps the mission valid through an ending swap', () => {
    const items = insertWaypoint(skeletonItems(), { lat: 5, lon: 6 })
    const landed = setEndingLandAtLastWaypoint(items)
    expect(validateMission(missionWith(landed)).valid).toBe(true)
  })
})
