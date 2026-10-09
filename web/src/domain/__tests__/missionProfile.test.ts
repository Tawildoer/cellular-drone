import { describe, expect, it } from 'vitest'
import { fromLocalEastNorthM } from '../geo'
import type { Mission, MissionItem } from '../mission'
import {
  buildMissionProfile,
  loiterRingPoints,
  loiterLapsDone,
  NO_LOITER_LAPS,
  remainingMission,
  returnHomeEstimate,
  trackLoiterLaps,
  sampleProfile,
  SITL_PERFORMANCE as P,
  terrainClearance,
} from '../missionProfile'

const HOME = { lat: -37.861, lon: 145.062 }
const at = (eastM: number, northM: number) => fromLocalEastNorthM(HOME, eastM, northM)
/** `at` (flat earth) and the profile (haversine) disagree by ~0.1%: compare to 10 m. */
const to10 = (m: number) => Math.round(m / 10) * 10

function mission(items: MissionItem[]): Mission {
  return { id: 'm', name: 'm', items, createdAt: 0, updatedAt: 0 }
}

describe('buildMissionProfile', () => {
  it('climbs at home, flies the legs and lands back at home on RTL', () => {
    const p = buildMissionProfile(
      mission([
        { type: 'vtolTakeoff', altM: 40 },
        { type: 'waypoint', ...at(0, 1000), altM: 80 },
        { type: 'returnToLaunch' },
      ]),
      HOME,
    )
    expect(p.vertices.map((v) => [to10(v.distanceM), v.altM, v.itemIndex])).toEqual([
      [0, 0, null],
      [0, 40, 0],
      [1000, 80, 1],
      [2000, P.rtlAltM, 2], // RTL flies home at RTL_ALTITUDE
      [2000, 0, 2],
    ])
    expect(to10(p.routeDistanceM)).toBe(2000)
    expect(p.maxAltM).toBe(80)
    const expected =
      40 / P.vtolClimbMps +
      P.transitionS +
      p.routeDistanceM / P.cruiseMps +
      P.backTransitionS +
      (P.rtlAltM - P.landFinalAltM) / P.vtolDescentMps +
      P.landFinalAltM / P.landFinalMps
    expect(p.durationS).toBeCloseTo(expected, 0)
    expect(p.durationIsMinimum).toBe(false)
  })

  it('flies to a VTOL land point at the height it has, then descends', () => {
    const p = buildMissionProfile(
      mission([
        { type: 'vtolTakeoff', altM: 30 },
        { type: 'waypoint', ...at(500, 0), altM: 70 },
        { type: 'vtolLand', ...at(1000, 0) },
        { type: 'waypoint', ...at(5000, 0), altM: 70 }, // after landing: never flown
      ]),
      HOME,
    )
    const last = p.vertices.slice(-2).map((v) => [to10(v.distanceM), v.altM, v.itemIndex])
    expect(last).toEqual([
      [1000, 70, 2],
      [1000, 0, 2],
    ])
    expect(to10(p.routeDistanceM)).toBe(1000)
  })

  it('counts loiter laps in distance and time, and a clock loiter as a minimum', () => {
    const items: MissionItem[] = [
      { type: 'vtolTakeoff', altM: 40 },
      { type: 'loiter', ...at(0, 1000), altM: 60, radiusM: 100, turns: 3 },
      { type: 'returnToLaunch' },
    ]
    const laps = buildMissionProfile(mission(items), HOME)
    expect(laps.flownDistanceM - laps.routeDistanceM).toBeCloseTo(3 * 2 * Math.PI * 100, 0)
    expect(laps.loiters).toHaveLength(1)
    expect(to10(laps.loiters[0]!.distanceM)).toBe(1000)

    const clock = buildMissionProfile(
      mission([items[0]!, { type: 'loiter', ...at(0, 1000), altM: 60, radiusM: 100, untilUtcMinuteOfDay: 600 }, items[2]!]),
      HOME,
    )
    expect(clock.durationIsMinimum).toBe(true)
    expect(clock.flownDistanceM - clock.routeDistanceM).toBeCloseTo(2 * Math.PI * 100, 0)
  })
})

describe('sampleProfile', () => {
  it('samples the horizontal legs only, without repeating shared ends', () => {
    const p = buildMissionProfile(
      mission([
        { type: 'vtolTakeoff', altM: 40 },
        { type: 'waypoint', ...at(0, 1000), altM: 80 },
        { type: 'returnToLaunch' },
      ]),
      HOME,
    )
    const samples = sampleProfile(p, 250)
    const distances = samples.map((s) => to10(s.distanceM))
    expect(distances).toEqual([0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000])
    expect(samples[0]!.altM).toBe(40) // the climb itself isn't sampled
    expect(samples[2]!.altM).toBeCloseTo(60) // halfway up the first leg
    expect(samples.at(-1)!.altM).toBe(P.rtlAltM)
  })
})

describe('terrainClearance', () => {
  const p = buildMissionProfile(
    mission([
      { type: 'vtolTakeoff', altM: 40 },
      { type: 'loiter', ...at(0, 1000), altM: 60, radiusM: 100, turns: 1 },
      { type: 'returnToLaunch' },
    ]),
    HOME,
  )
  const samples = sampleProfile(p, 500)

  it('measures from the ground at home, and finds the lowest point', () => {
    // Home ground 100 m AMSL; a 75 m AMSL-higher hill at the second sample.
    const ground = samples.map((_, i) => (i === 1 ? 175 : 100))
    const ring = [loiterRingPoints(p.loiters[0]!).map(() => 120)]
    const result = terrainClearance(samples, ground, p.loiters, ring, 100)
    expect(result.samples[1]!.groundM).toBe(75)
    expect(result.samples[1]!.clearanceM).toBeCloseTo(50 - 75) // planned 50 there
    expect(result.lowest).toMatchObject({ itemIndex: 0, onLoiter: false })
    expect(result.lowest!.clearanceM).toBeCloseTo(-25)
    expect(result.loiters).toEqual([{ itemIndex: 1, clearanceM: 40 }])
    expect(result.incomplete).toBe(false)
  })

  it('flags a loiter circle over high ground, and missing data', () => {
    const ground = samples.map((_, i) => (i === 0 ? null : 100))
    const ring = [loiterRingPoints(p.loiters[0]!).map((_, k) => (k === 3 ? 150 : 100))]
    const result = terrainClearance(samples, ground, p.loiters, ring, 100)
    expect(result.lowest).toMatchObject({ itemIndex: 1, onLoiter: true, clearanceM: 10 })
    expect(result.incomplete).toBe(true)
    expect(result.samples[0]!.clearanceM).toBeNull()
  })
})

describe('in flight', () => {
  const m = mission([
    { type: 'vtolTakeoff', altM: 40 },
    { type: 'waypoint', ...at(0, 1000), altM: 60 },
    { type: 'waypoint', ...at(0, 2000), altM: 60 },
    { type: 'returnToLaunch' },
  ])

  it('counts what is left from the aircraft, starting at the item it is flying to', () => {
    // Cruising, halfway to item 2 (1000 m north), heading for it.
    const r = remainingMission(m, 2, { point: at(0, 1500), altM: 60, fixedWing: true }, HOME, { nowMs: 0 })!
    expect(to10(r.toCurrentM)).toBe(500)
    expect(to10(r.remainingM)).toBe(500 + 2000) // to item 2, then home
    // No transition: already fixed-wing.
    expect(r.remainingS).toBeLessThan(2500 / P.cruiseMps + P.backTransitionS + 60)
    expect(r.isMinimum).toBe(false)
  })

  it('only climbs what is left of a takeoff', () => {
    const r = remainingMission(m, 0, { point: HOME, altM: 30, fixedWing: false }, HOME, { nowMs: 0 })!
    expect(r.toCurrentM).toBe(0)
    const fromGround = remainingMission(m, 0, { point: HOME, altM: 0, fixedWing: false }, HOME, { nowMs: 0 })!
    expect(fromGround.remainingS - r.remainingS).toBeCloseTo(30 / P.vtolClimbMps)
  })

  it('has nothing for an index outside the mission', () => {
    expect(remainingMission(m, 9, { point: HOME, altM: 0, fixedWing: false }, HOME, { nowMs: 0 })).toBeNull()
  })

  it('estimates the way home as RTL flies it', () => {
    const home = returnHomeEstimate({ point: at(0, 2500), altM: 60, fixedWing: true }, HOME)
    expect(to10(home.distanceM)).toBe(2500)
    expect(home.durationS).toBeCloseTo(
      home.distanceM / P.cruiseMps + P.backTransitionS + (P.rtlAltM - P.landFinalAltM) / P.vtolDescentMps + P.landFinalAltM / P.landFinalMps,
      0,
    )
  })
})

describe('loiters in flight', () => {
  const lap = (radiusM: number) => (2 * Math.PI * radiusM) / P.cruiseMps
  const centre = at(0, 1000)

  it('counts only the laps left of the loiter being circled', () => {
    const m = mission([{ type: 'loiter', ...centre, altM: 60, radiusM: 100, turns: 10 }, { type: 'returnToLaunch' }])
    const onCircle = { point: at(100, 1000), altM: 60, fixedWing: true }
    const fresh = remainingMission(m, 0, onCircle, HOME, { nowMs: 0, lapsDoneAtFirstItem: 0 })!
    const sevenDone = remainingMission(m, 0, onCircle, HOME, { nowMs: 0, lapsDoneAtFirstItem: 7 })!
    expect(fresh.remainingS - sevenDone.remainingS).toBeCloseTo(7 * lap(100), 0)
    const allDone = remainingMission(m, 0, onCircle, HOME, { nowMs: 0, lapsDoneAtFirstItem: 12 })!
    expect(fresh.remainingS - allDone.remainingS).toBeCloseTo(10 * lap(100), 0) // never negative laps
  })

  it('runs a clock-mode loiter to its end time, at least one lap', () => {
    const until = 10 * 60 // 10:00 UTC
    const m = mission([{ type: 'loiter', ...centre, altM: 60, radiusM: 100, untilUtcMinuteOfDay: until }, { type: 'returnToLaunch' }])
    const onCircle = { point: at(100, 1000), altM: 60, fixedWing: true }
    const nineThirty = Date.UTC(2026, 9, 9, 9, 30)
    const half = remainingMission(m, 0, onCircle, HOME, { nowMs: nineThirty })!
    const late = remainingMission(m, 0, onCircle, HOME, { nowMs: Date.UTC(2026, 9, 9, 10, 5) })!
    expect(half.isMinimum).toBe(false)
    // About 30 minutes of loitering more than when the time has already passed (one lap).
    expect(half.remainingS - late.remainingS).toBeCloseTo(30 * 60 - lap(100), -1)
  })

  it('stays a minimum when planning, with no start time', () => {
    const m = mission([{ type: 'loiter', ...centre, altM: 60, radiusM: 100, untilUtcMinuteOfDay: 600 }])
    expect(buildMissionProfile(m, HOME).durationIsMinimum).toBe(true)
  })

  it('tracks laps from the angle swept around the centre, and resets for a new item', () => {
    const m = mission([{ type: 'vtolTakeoff', altM: 40 }, { type: 'loiter', ...centre, altM: 60, radiusM: 100, turns: 5 }])
    const onCircleAt = (deg: number) =>
      fromLocalEastNorthM(centre, 100 * Math.sin((deg * Math.PI) / 180), 100 * Math.cos((deg * Math.PI) / 180))
    let t = trackLoiterLaps(NO_LOITER_LAPS, m, 1, at(0, 0)) // far away: not circling
    expect(t.lastBearingDeg).toBeNull()
    for (let deg = 0; deg <= 540; deg += 30) t = trackLoiterLaps(t, m, 1, onCircleAt(deg))
    expect(loiterLapsDone(t)).toBeCloseTo(1.5, 1)
    t = trackLoiterLaps(t, m, 0, onCircleAt(0)) // a different item
    expect(loiterLapsDone(t)).toBe(0)
  })
})

