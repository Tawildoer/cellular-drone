import { describe, expect, it } from 'vitest'
import { applyHeadingNoise, groundVelocityMps, lookAheadPoint, stepPosition, stepToward1D, turnToward } from '../flightDynamics'

const METERS_PER_DEG_LAT = 111_320
// A north-pointing 1000m line starting at the equator/prime-meridian, purely
// to keep the lat/lon <-> metres conversion trivial (cos(0) = 1) in these tests.
const LINE_FROM = { lat: 0, lon: 0 }
const LINE_TO = { lat: 1000 / METERS_PER_DEG_LAT, lon: 0 }
const north = (m: number) => m / METERS_PER_DEG_LAT
const east = (m: number) => m / METERS_PER_DEG_LAT // cos(0) = 1

describe('turnToward', () => {
  it('reaches the desired heading directly when within budget', () => {
    expect(turnToward(0, 10, 20, 1)).toBe(10)
  })

  it('clamps the turn to maxTurnRateDegPerS * dtS when the target is further away', () => {
    expect(turnToward(0, 90, 20, 1)).toBe(20)
  })

  it('turns via the shorter direction across the 0/360 wrap', () => {
    // From 350 to 10 is only +20 the short way, not -340 the long way.
    expect(turnToward(350, 10, 20, 1)).toBeCloseTo(10, 5)
  })

  it('turns negative (counter-clockwise) when that is shorter', () => {
    expect(turnToward(10, 350, 20, 1)).toBeCloseTo(350, 5)
  })

  it('does not overshoot past the desired heading', () => {
    expect(turnToward(0, 5, 20, 1)).toBe(5)
  })
})

describe('stepToward1D', () => {
  it('reaches the target directly when within budget', () => {
    expect(stepToward1D(10, 15, 3)).toBe(13)
  })

  it('clamps the step when the target is further away', () => {
    expect(stepToward1D(10, 100, 3)).toBe(13)
  })

  it('steps downward when the target is below', () => {
    expect(stepToward1D(50, 10, 3)).toBe(47)
  })

  it('does not overshoot past the target', () => {
    expect(stepToward1D(10, 12, 3)).toBe(12)
  })
})

describe('applyHeadingNoise', () => {
  it('is a no-op at zero magnitude', () => {
    expect(applyHeadingNoise(45, 0, 1)).toBe(45)
  })

  it('jitters deterministically with a fixed rng', () => {
    // rng() => 1 -> max positive jitter of magnitudeDegPerS * sqrt(dtS)
    expect(applyHeadingNoise(45, 2, 1, () => 1)).toBeCloseTo(47, 5)
    // rng() => 0 -> max negative jitter
    expect(applyHeadingNoise(45, 2, 1, () => 0)).toBeCloseTo(43, 5)
    // rng() => 0.5 -> no jitter
    expect(applyHeadingNoise(45, 2, 1, () => 0.5)).toBeCloseTo(45, 5)
  })

  it('wraps around 0/360', () => {
    expect(applyHeadingNoise(359, 2, 1, () => 1)).toBeCloseTo(1, 5)
  })
})

describe('groundVelocityMps', () => {
  it('is purely airspeed-driven in calm wind', () => {
    const north = groundVelocityMps(0, 10, { speedMps: 0, directionDeg: 0 })
    expect(north.northMps).toBeCloseTo(10, 5)
    expect(north.eastMps).toBeCloseTo(0, 5)

    const east = groundVelocityMps(90, 10, { speedMps: 0, directionDeg: 0 })
    expect(east.eastMps).toBeCloseTo(10, 5)
    expect(east.northMps).toBeCloseTo(0, 5)
  })

  it('a headwind reduces ground speed', () => {
    // Flying north (heading 0) into wind blowing FROM the north (directionDeg 0).
    const v = groundVelocityMps(0, 10, { speedMps: 4, directionDeg: 0 })
    expect(Math.hypot(v.eastMps, v.northMps)).toBeCloseTo(6, 5)
  })

  it('a tailwind increases ground speed', () => {
    // Flying north into wind blowing FROM the south (directionDeg 180).
    const v = groundVelocityMps(0, 10, { speedMps: 4, directionDeg: 180 })
    expect(Math.hypot(v.eastMps, v.northMps)).toBeCloseTo(14, 5)
  })
})

describe('stepPosition', () => {
  it('moving north increases latitude', () => {
    const p = stepPosition({ lat: 0, lon: 0 }, 0, 10, 1)
    expect(p.lat).toBeGreaterThan(0)
    expect(p.lon).toBeCloseTo(0, 6)
  })

  it('moving east increases longitude', () => {
    const p = stepPosition({ lat: 0, lon: 0 }, 10, 0, 1)
    expect(p.lon).toBeGreaterThan(0)
    expect(p.lat).toBeCloseTo(0, 6)
  })

  it('is a no-op at zero velocity', () => {
    const p = stepPosition({ lat: 1, lon: 2 }, 0, 0, 1)
    expect(p).toEqual({ lat: 1, lon: 2 })
  })
})

describe('lookAheadPoint', () => {
  it('on the line, aims lookAheadM further along it', () => {
    const position = { lat: north(100), lon: 0 }
    const carrot = lookAheadPoint(position, LINE_FROM, LINE_TO, 40)
    expect(carrot.lat).toBeCloseTo(north(140), 6)
    expect(carrot.lon).toBeCloseTo(0, 6)
  })

  it('off the line, re-converges onto it (Pythagoras: aheadM = sqrt(L1^2 - crossTrack^2))', () => {
    const position = { lat: north(100), lon: east(30) }
    const carrot = lookAheadPoint(position, LINE_FROM, LINE_TO, 50) // sqrt(50^2 - 30^2) = 40
    expect(carrot.lat).toBeCloseTo(north(140), 6)
    expect(carrot.lon).toBeCloseTo(0, 6) // back on the line, not still offset east
  })

  it('clamps at the end of the segment near the final waypoint', () => {
    const position = { lat: north(980), lon: 0 }
    const carrot = lookAheadPoint(position, LINE_FROM, LINE_TO, 40)
    expect(carrot).toEqual(LINE_TO)
  })

  it('aims at the closest point on the line when too far off-track to look ahead at all', () => {
    const position = { lat: north(100), lon: east(100) } // 100m cross-track, lookahead only 40
    const carrot = lookAheadPoint(position, LINE_FROM, LINE_TO, 40)
    expect(carrot.lat).toBeCloseTo(north(100), 6) // same along-track position
    expect(carrot.lon).toBeCloseTo(0, 6) // pulled back onto the line
  })

  it('returns `to` for a degenerate (near-zero-length) segment', () => {
    const carrot = lookAheadPoint({ lat: 5, lon: 5 }, LINE_FROM, LINE_FROM, 40)
    expect(carrot).toEqual(LINE_FROM)
  })
})
