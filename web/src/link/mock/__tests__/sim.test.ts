import { describe, expect, it } from 'vitest'
import { haversineDistanceM } from '../../../domain/geo'
import type { Mission } from '../../../domain/mission'
import { DEFAULT_ACCEPT_RADIUS_M, type Wind } from '../flightDynamics'
import {
  deriveVtolState,
  defaultFlightPhysicsConfig,
  initialSimState,
  isFlying,
  setPaused,
  startMission,
  startQland,
  startRtl,
  stepSim,
  minTurnRadiusM,
  CRUISE_SPEED_MPS,
  CRUISE_VERTICAL_RATE_MPS,
  TAKEOFF_CLIMB_MPS,
  type FlightPhysicsConfig,
  type SimState,
} from '../sim'

const home = { lat: 0, lon: 0, altAmslM: 0 }

function mission(): Mission {
  return {
    id: 'm1',
    name: 'test',
    items: [
      { type: 'vtolTakeoff', altM: 30 },
      { type: 'waypoint', lat: 0, lon: 0.01, altM: 30 },
      { type: 'loiter', lat: 0, lon: 0.01, altM: 30, radiusM: 50 },
      { type: 'vtolLand', lat: 0, lon: 0.01 },
    ],
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('stepSim', () => {
  it('stays idle without a mission', () => {
    const state = stepSim(initialSimState(home), null, 1)
    expect(state.phase).toBe('idle')
  })

  it('climbs during takeoff', () => {
    let state = startMission(initialSimState(home), mission())
    state = stepSim(state, mission(), 1)
    expect(state.phase).toBe('takeoff')
    expect(state.position.altRelM).toBeCloseTo(TAKEOFF_CLIMB_MPS, 3)
  })

  it('transitions to fixed-wing after reaching takeoff altitude and the transition timer', () => {
    const m = mission()
    // 30m takeoff at 3m/s = 10s, plus a 5s transition: well into cruise by t=20s.
    let state = startMission(initialSimState(home), m)
    for (let i = 0; i < 20; i++) state = stepSim(state, m, 1)
    expect(state.phase).toBe('cruise')
    expect(deriveVtolState(state.phase)).toBe('fw')
  })

  it('advances through waypoint, loiter, land to a full stop', () => {
    const m = mission()
    let state = startMission(initialSimState(home), m)
    for (let i = 0; i < 2000 && state.phase !== 'landed'; i++) {
      state = stepSim(state, m, 1)
    }
    expect(state.phase).toBe('landed')
    expect(state.position.altRelM).toBe(0)
  })

  it('drains the battery while flying', () => {
    const m = mission()
    let state = startMission(initialSimState(home), m)
    const before = state.batteryPercent
    for (let i = 0; i < 10; i++) state = stepSim(state, m, 1)
    expect(state.batteryPercent).toBeLessThan(before)
  })

  it('does not move while paused', () => {
    const m = mission()
    let state = startMission(initialSimState(home), m)
    state = stepSim(state, m, 1)
    const paused = setPaused(state, true)
    const after = stepSim(paused, m, 5)
    expect(after.position).toEqual(paused.position)
    expect(after.phase).toBe(paused.phase)
  })

  it('startRtl heads towards home and eventually lands', () => {
    const m = mission()
    let state = startMission(initialSimState(home), m)
    state = { ...state, position: { lat: 0, lon: 0.02, altRelM: 30, altAmslM: 30 } }
    state = startRtl(state)
    expect(state.phase).toBe('rtl')
    for (let i = 0; i < 2000 && state.phase !== 'landed'; i++) {
      state = stepSim(state, m, 1)
    }
    expect(state.phase).toBe('landed')
    expect(state.position.lat).toBeCloseTo(home.lat, 3)
    expect(state.position.lon).toBeCloseTo(home.lon, 3)
  })

  it('faces the first mission item immediately on start, not a stale heading from a prior flight', () => {
    const m = mission() // first real item: waypoint at (0, 0.01) — due east of home (0, 0)
    let state: SimState = { ...initialSimState(home), headingDeg: 225 } // stale "southwest" from a previous RTL leg
    state = startMission(state, m)
    expect(state.headingDeg).toBeCloseTo(90, 0)
  })

  it('startQland descends and lands in place', () => {
    let state: SimState = { ...initialSimState(home), phase: 'cruise', position: { lat: 0, lon: 0, altRelM: 30, altAmslM: 30 } }
    state = startQland(state)
    for (let i = 0; i < 100 && state.phase !== 'landed'; i++) {
      state = stepSim(state, mission(), 1)
    }
    expect(state.phase).toBe('landed')
  })
})

describe('flight physics (turn rate, wind)', () => {
  function cruisingState(headingDeg: number, target: { lat: number; lon: number }): SimState {
    return {
      ...initialSimState(home),
      phase: 'cruise',
      missionIndex: 1,
      headingDeg,
      groundSpeedMps: 18,
      target,
      position: { lat: 0, lon: 0, altRelM: 30, altAmslM: 30 },
    }
  }

  it('does not snap heading instantly to a sharply different target bearing', () => {
    const m = mission() // target at (0, 0.01) is due east (bearing 90) of (0,0)
    const state = cruisingState(270, { lat: 0, lon: 0.01 }) // currently facing due west
    const next = stepSim(state, m, 1, defaultFlightPhysicsConfig())

    const maxStep = defaultFlightPhysicsConfig().maxTurnRateDegPerS * 1
    const turned = Math.abs(((next.headingDeg - 270 + 540) % 360) - 180)
    expect(turned).toBeCloseTo(maxStep, 5)
    expect(next.headingDeg).not.toBeCloseTo(90, 0) // did not snap straight to the bearing
  })

  it('converges toward the target bearing given enough time (pursuit curve, not a straight snap)', () => {
    const m = mission()
    let state = cruisingState(270, { lat: 0, lon: 0.01 }) // starts off by ~180 degrees
    for (let i = 0; i < 20; i++) state = stepSim(state, m, 1, defaultFlightPhysicsConfig())
    // Re-aiming at the live bearing every tick while still laterally offset
    // from the direct line means it converges rather than landing exactly on
    // 90 — confirm the error has shrunk to a small fraction of where it started.
    const error = Math.abs(((state.headingDeg - 90 + 540) % 360) - 180)
    expect(error).toBeLessThan(10)
  })

  it('a crosswind drifts the aircraft off a pure-heading straight line', () => {
    const m = mission()
    const wind: Wind = { speedMps: 8, directionDeg: 270 } // blowing from the west -> pushes east
    const physics: FlightPhysicsConfig = { ...defaultFlightPhysicsConfig(), wind }

    // Heading already matches the bearing to target (due north), so with calm
    // wind the aircraft would track a straight line of constant longitude.
    const target = { lat: 0.05, lon: 0 }
    let withWind = cruisingState(0, target)
    let calm = cruisingState(0, target)
    for (let i = 0; i < 5; i++) {
      withWind = stepSim(withWind, m, 1, physics)
      calm = stepSim(calm, m, 1, defaultFlightPhysicsConfig())
    }

    expect(withWind.position.lon).toBeGreaterThan(calm.position.lon)
    expect(calm.position.lon).toBeCloseTo(0, 5) // calm wind stays on the line
  })

  it('a shorter look-ahead pulls cross-track error back onto the prescribed leg faster than a longer one', () => {
    const m: Mission = {
      id: 'm3',
      name: 'reconverge test',
      items: [
        { type: 'vtolTakeoff', altM: 30 },
        { type: 'waypoint', lat: 0, lon: 0.01, altM: 30 },
        { type: 'waypoint', lat: 0.01, lon: 0.01, altM: 30 }, // due north of waypoint 1 -- the prescribed leg
        { type: 'returnToLaunch' },
      ],
      createdAt: 0,
      updatedAt: 0,
    }
    const legStart = { lat: 0, lon: 0.01 }
    const target = { lat: 0.01, lon: 0.01 }
    const offEastM = 100
    const offEastDeg = offEastM / (111_320 * Math.cos(0))

    // Simulates "just came out of the turn": on leg 2 (waypoint 1 -> waypoint
    // 2), offset east of that line, already roughly facing along it.
    const baseState: SimState = {
      ...initialSimState(home),
      phase: 'cruise',
      missionIndex: 2,
      legStart,
      target,
      headingDeg: 10,
      groundSpeedMps: 18,
      position: { lat: legStart.lat, lon: legStart.lon + offEastDeg, altRelM: 30, altAmslM: 30 },
    }
    // The leg runs due north (constant longitude), so cross-track error is
    // just the longitude offset from legStart, converted to metres.
    const crossTrackM = (s: SimState) => Math.abs(s.position.lon - legStart.lon) * 111_320 * Math.cos(0)

    let tight = baseState
    let loose = baseState
    const tightPhysics: FlightPhysicsConfig = { ...defaultFlightPhysicsConfig(), lookAheadM: 150 }
    const loosePhysics: FlightPhysicsConfig = { ...defaultFlightPhysicsConfig(), lookAheadM: 5000 } // ~= aim straight at the final waypoint
    for (let i = 0; i < 5; i++) {
      tight = stepSim(tight, m, 1, tightPhysics)
      loose = stepSim(loose, m, 1, loosePhysics)
    }

    expect(crossTrackM(tight)).toBeLessThan(crossTrackM(loose))
    expect(crossTrackM(tight)).toBeLessThan(offEastM) // actually converging, not just drifting less
  })

  it('respects a waypoint item custom acceptRadiusM for arrival', () => {
    const m: Mission = {
      id: 'm2',
      name: 'accept-radius test',
      items: [
        { type: 'vtolTakeoff', altM: 30 },
        { type: 'waypoint', lat: 0, lon: 0.01, altM: 30, acceptRadiusM: 5000 },
        { type: 'returnToLaunch' },
      ],
      createdAt: 0,
      updatedAt: 0,
    }
    // Start far outside the default accept radius but well inside the custom one.
    const farPoint = { lat: 0, lon: 0.005 }
    expect(haversineDistanceM(farPoint, { lat: 0, lon: 0.01 })).toBeGreaterThan(100)

    const state = cruisingState(90, { lat: 0, lon: 0.01 })
    const next = stepSim({ ...state, position: { ...state.position, ...farPoint } }, m, 1, defaultFlightPhysicsConfig())
    // Large custom accept radius means it's already "arrived" and moved on to RTL.
    expect(next.phase).toBe('rtl')
  })
})

describe('3D cleared radius / altitude convergence', () => {
  const climbMission: Mission = {
    id: 'm4',
    name: 'altitude test',
    items: [
      { type: 'vtolTakeoff', altM: 30 },
      { type: 'waypoint', lat: 0, lon: 0.01, altM: 100 },
      { type: 'returnToLaunch' },
    ],
    createdAt: 0,
    updatedAt: 0,
  }

  function cruiseTowardAltitude(targetAltM: number, position: SimState['position']): SimState {
    return {
      ...initialSimState(home),
      phase: 'cruise',
      missionIndex: 1,
      headingDeg: 90,
      groundSpeedMps: 18,
      target: { lat: 0, lon: 0.01 },
      legStart: { lat: 0, lon: 0 },
      targetAltM,
      position,
    }
  }

  it('climbs toward the targeted waypoint altitude during cruise, rate-limited not instant', () => {
    const state = cruiseTowardAltitude(100, { lat: 0, lon: 0, altRelM: 30, altAmslM: 30 })
    const next = stepSim(state, climbMission, 1, defaultFlightPhysicsConfig())
    expect(next.position.altRelM).toBeGreaterThan(30)
    expect(next.position.altRelM).toBeLessThanOrEqual(30 + CRUISE_VERTICAL_RATE_MPS)
  })

  it('does not clear a waypoint that is horizontally on top of it but still far off in altitude', () => {
    const nearHorizontal = { lat: 0, lon: 0.01, altRelM: 30, altAmslM: 30 } // 70m short in altitude
    const state = cruiseTowardAltitude(100, nearHorizontal)
    const next = stepSim(state, climbMission, 1, defaultFlightPhysicsConfig())
    expect(next.phase).toBe('cruise')
    expect(next.missionIndex).toBe(1) // still targeting the same item, not advanced
  })

  it('clears a waypoint once genuinely close in both horizontal and vertical', () => {
    const closeIn3D = { lat: 0, lon: 0.01, altRelM: 95, altAmslM: 95 } // ~5m vertical, on top horizontally
    const state = cruiseTowardAltitude(100, closeIn3D)
    const next = stepSim(state, climbMission, 1, defaultFlightPhysicsConfig())
    expect(next.missionIndex).toBe(2) // advanced past the waypoint
    expect(next.phase).toBe('rtl')
  })

  it('keeps tracking the same waypoint (go-around) if overshot horizontally while still converging vertically, and eventually clears it', () => {
    // Already flew past the waypoint's longitude, but altitude hasn't caught up.
    const overshot = { lat: 0, lon: 0.011, altRelM: 30, altAmslM: 30 }
    let state = cruiseTowardAltitude(100, overshot)

    // Immediately after overshooting, not cleared yet -- still the same target.
    for (let i = 0; i < 3; i++) state = stepSim(state, climbMission, 1, defaultFlightPhysicsConfig())
    expect(state.phase).toBe('cruise')
    expect(state.missionIndex).toBe(1)

    // Given enough time to loop back around and finish climbing, it does clear it.
    for (let i = 0; i < 60 && state.phase === 'cruise'; i++) {
      state = stepSim(state, climbMission, 1, defaultFlightPhysicsConfig())
    }
    expect(state.missionIndex).toBe(2)
    expect(state.phase).toBe('rtl')
  })
})

describe('loiter (physically flown orbit)', () => {
  const DT_S = 0.1
  const physics = defaultFlightPhysicsConfig()
  const center = { lat: 0, lon: 0.01 }

  function loiterMission(radiusM: number, after: Mission['items']): Mission {
    return {
      id: 'm5',
      name: 'loiter test',
      items: [{ type: 'vtolTakeoff', altM: 30 }, { type: 'loiter', ...center, altM: 30, radiusM }, ...after],
      createdAt: 0,
      updatedAt: 0,
    }
  }

  /** Flies the whole mission, recording what a real airframe would
   * constrain: per-tick heading change and per-tick distance travelled. */
  function fly(m: Mission, maxTicks = 20000, startClockMs = 0) {
    let state = startMission(initialSimState(home, startClockMs), m)
    let maxHeadingStepDeg = 0
    let maxPositionStepM = 0
    const loiterDistancesM: number[] = []
    let maxSweptDeg = 0
    let loiterEndClockMs: number | null = null
    for (let i = 0; i < maxTicks && state.phase !== 'landed'; i++) {
      const prev = state
      state = stepSim(state, m, DT_S, physics)
      if (prev.phase === 'loiter' && state.phase !== 'loiter') loiterEndClockMs = state.clockMs
      if (prev.phase !== 'takeoff' && prev.phase !== 'idle') {
        maxHeadingStepDeg = Math.max(maxHeadingStepDeg, Math.abs(((state.headingDeg - prev.headingDeg + 540) % 360) - 180))
      }
      maxPositionStepM = Math.max(maxPositionStepM, haversineDistanceM(prev.position, state.position))
      if (state.phase === 'loiter') loiterDistancesM.push(haversineDistanceM(state.position, center))
      // Every tick, not just while in 'loiter': the tick that crosses 360°
      // can also be the one that exits.
      maxSweptDeg = Math.max(maxSweptDeg, state.loiterSweptDeg)
    }
    return { state, maxHeadingStepDeg, maxPositionStepM, loiterDistancesM, maxSweptDeg, loiterEndClockMs }
  }

  function loiterMissionWith(extra: { turns?: number; untilUtcMinuteOfDay?: number }): Mission {
    const m = loiterMission(80, [{ type: 'returnToLaunch' }])
    return { ...m, items: m.items.map((item) => (item.type === 'loiter' ? { ...item, ...extra } : item)) }
  }

  it('laps mode flies the full number of laps before leaving', () => {
    const run = fly(loiterMissionWith({ turns: 3 }))
    expect(run.state.phase).toBe('landed')
    expect(run.maxSweptDeg).toBeGreaterThanOrEqual(3 * 360)
    expect(run.maxSweptDeg).toBeLessThan(5 * 360) // at most one extra lap lining up the exit
  })

  describe('clock mode', () => {
    const NOON_UTC_MS = Date.UTC(2026, 0, 1, 12, 0)

    it('keeps lapping until the end time, then leaves', () => {
      const run = fly(loiterMissionWith({ untilUtcMinuteOfDay: 12 * 60 + 5 }), 40000, NOON_UTC_MS) // until 12:05 UTC
      expect(run.state.phase).toBe('landed')
      expect(run.loiterEndClockMs).not.toBeNull()
      expect(run.loiterEndClockMs!).toBeGreaterThanOrEqual(Date.UTC(2026, 0, 1, 12, 5))
      expect(run.maxSweptDeg).toBeGreaterThan(2 * 360) // 5 minutes is several laps at 80m
    })

    it('arriving after the end time still flies the minimum single lap, not a ~24h wait', () => {
      const run = fly(loiterMissionWith({ untilUtcMinuteOfDay: 11 * 60 + 55 }), 40000, NOON_UTC_MS) // 11:55, already past
      expect(run.state.phase).toBe('landed')
      expect(run.maxSweptDeg).toBeGreaterThanOrEqual(360)
      expect(run.maxSweptDeg).toBeLessThan(3 * 360)
    })
  })

  it('never turns faster than the max turn rate or jumps position, from approach through exit', () => {
    const run = fly(loiterMission(80, [{ type: 'waypoint', lat: 0.005, lon: 0.012, altM: 30 }, { type: 'returnToLaunch' }]))
    expect(run.state.phase).toBe('landed')
    expect(run.maxHeadingStepDeg).toBeLessThanOrEqual(physics.maxTurnRateDegPerS * DT_S + 1e-9)
    expect(run.maxPositionStepM).toBeLessThanOrEqual(CRUISE_SPEED_MPS * DT_S + 0.01)
  })

  it('settles onto the circle and completes at least one full lap before continuing', () => {
    const run = fly(loiterMission(80, [{ type: 'waypoint', lat: 0.005, lon: 0.012, altM: 30 }, { type: 'returnToLaunch' }]))
    expect(run.maxSweptDeg).toBeGreaterThanOrEqual(360)
    const settled = run.loiterDistancesM.slice(Math.floor(run.loiterDistancesM.length / 2))
    for (const d of settled) expect(Math.abs(d - 80)).toBeLessThan(10)
  })

  it('joins the lap at a tangent rather than cutting inside the circle and turning back out', () => {
    const run = fly(loiterMission(80, [{ type: 'returnToLaunch' }]))
    expect(Math.min(...run.loiterDistancesM)).toBeGreaterThan(80 - 10)
  })

  it('flies a radius tighter than the aircraft can turn at its minimum turn radius instead', () => {
    const minR = minTurnRadiusM(physics.maxTurnRateDegPerS)
    const run = fly(loiterMission(20, [{ type: 'returnToLaunch' }]))
    expect(run.state.phase).toBe('landed')
    const settled = run.loiterDistancesM.slice(Math.floor(run.loiterDistancesM.length / 2))
    for (const d of settled) expect(d).toBeGreaterThan(minR)
  })

  it('reaches a next target at the loiter center (e.g. land here) without orbiting forever or teleporting', () => {
    const run = fly(loiterMission(50, [{ type: 'vtolLand', ...center }]))
    expect(run.state.phase).toBe('landed')
    expect(haversineDistanceM(run.state.position, center)).toBeLessThan(DEFAULT_ACCEPT_RADIUS_M + 1)
    expect(run.maxHeadingStepDeg).toBeLessThanOrEqual(physics.maxTurnRateDegPerS * DT_S + 1e-9)
    expect(run.maxPositionStepM).toBeLessThanOrEqual(CRUISE_SPEED_MPS * DT_S + 0.01)
  })
})

describe('reaching a point inside the turning circle', () => {
  it('extends away then turns back instead of orbiting the target forever', () => {
    const m: Mission = {
      id: 'm6',
      name: 'tangential start',
      items: [{ type: 'vtolTakeoff', altM: 30 }, { type: 'waypoint', lat: 0, lon: 0, altM: 30 }, { type: 'returnToLaunch' }],
      createdAt: 0,
      updatedAt: 0,
    }
    // 55m due east of the waypoint, heading due south: tangential, just
    // outside the minimum turn radius — pure pursuit orbits this forever.
    let state: SimState = {
      ...initialSimState(home),
      phase: 'cruise',
      missionIndex: 1,
      headingDeg: 180,
      groundSpeedMps: 18,
      target: { lat: 0, lon: 0 },
      legStart: { lat: 0, lon: 0 },
      targetAltM: 30,
      position: { lat: 0, lon: 55 / 111_320, altRelM: 30, altAmslM: 30 },
    }
    for (let i = 0; i < 1200 && state.missionIndex === 1; i++) state = stepSim(state, m, 0.1, defaultFlightPhysicsConfig())
    expect(state.missionIndex).toBe(2)
  })
})

describe('isFlying / deriveVtolState', () => {
  it('idle and landed are not flying and are multicopter', () => {
    expect(isFlying('idle')).toBe(false)
    expect(isFlying('landed')).toBe(false)
    expect(deriveVtolState('idle')).toBe('mc')
    expect(deriveVtolState('landed')).toBe('mc')
  })

  it('cruise/loiter/rtl are flying and fixed-wing', () => {
    for (const phase of ['cruise', 'loiter', 'rtl'] as const) {
      expect(isFlying(phase)).toBe(true)
      expect(deriveVtolState(phase)).toBe('fw')
    }
  })
})
