import { describe, expect, it } from 'vitest'
import {
  alongTrackFraction,
  bearingDeg,
  distanceToPolygonEdgeM,
  fromLocalEastNorthM,
  haversineDistanceM,
  isPointInPolygon,
  moveToward,
  pathLengthM,
  projectOntoSegment,
  segmentsIntersect,
} from '../geo'

const METERS_PER_DEG_LAT = 111_320
// A north-pointing 1000m line starting at the equator/prime-meridian, purely
// to keep the lat/lon <-> metres conversion trivial (cos(0) = 1) in these tests.
const LINE_FROM = { lat: 0, lon: 0 }
const LINE_TO = { lat: 1000 / METERS_PER_DEG_LAT, lon: 0 }
const north = (m: number) => m / METERS_PER_DEG_LAT
const east = (m: number) => m / METERS_PER_DEG_LAT // cos(0) = 1

describe('haversineDistanceM', () => {
  it('is zero for the same point', () => {
    expect(haversineDistanceM({ lat: 51.5, lon: -0.1 }, { lat: 51.5, lon: -0.1 })).toBe(0)
  })

  it('matches a known distance (London to Paris, ~344km)', () => {
    const london = { lat: 51.5074, lon: -0.1278 }
    const paris = { lat: 48.8566, lon: 2.3522 }
    const distanceKm = haversineDistanceM(london, paris) / 1000
    expect(distanceKm).toBeGreaterThan(330)
    expect(distanceKm).toBeLessThan(350)
  })
})

describe('isPointInPolygon', () => {
  const square = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 1 },
    { lat: 1, lon: 1 },
    { lat: 1, lon: 0 },
  ]

  it('returns true for a point inside', () => {
    expect(isPointInPolygon({ lat: 0.5, lon: 0.5 }, square)).toBe(true)
  })

  it('returns false for a point outside', () => {
    expect(isPointInPolygon({ lat: 2, lon: 2 }, square)).toBe(false)
  })

  it('returns false for a degenerate polygon', () => {
    expect(isPointInPolygon({ lat: 0, lon: 0 }, [{ lat: 0, lon: 0 }])).toBe(false)
  })
})

describe('bearingDeg', () => {
  it('is ~0 for due north', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 1)
  })

  it('is ~90 for due east', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 1)
  })

  it('is ~180 for due south', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: -1, lon: 0 })).toBeCloseTo(180, 1)
  })
})

describe('moveToward', () => {
  it('snaps to the target when the step would overshoot', () => {
    const result = moveToward({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, 10_000)
    expect(result.arrived).toBe(true)
    expect(result.point).toEqual({ lat: 0, lon: 0.001 })
  })

  it('moves partway without arriving when the step is short', () => {
    const start = { lat: 0, lon: 0 }
    const target = { lat: 0, lon: 1 }
    const result = moveToward(start, target, 1000)
    expect(result.arrived).toBe(false)
    expect(haversineDistanceM(start, result.point)).toBeCloseTo(1000, -1)
  })

  it('treats a zero-distance target as arrived', () => {
    const point = { lat: 5, lon: 5 }
    expect(moveToward(point, point, 100).arrived).toBe(true)
  })
})

describe('pathLengthM', () => {
  it('is zero for fewer than two points', () => {
    expect(pathLengthM([])).toBe(0)
    expect(pathLengthM([{ lat: 0, lon: 0 }])).toBe(0)
  })

  it('sums consecutive segment distances', () => {
    const a = { lat: 0, lon: 0 }
    const b = { lat: 0, lon: 1 }
    const c = { lat: 0, lon: 2 }
    const total = pathLengthM([a, b, c])
    expect(total).toBeCloseTo(haversineDistanceM(a, b) + haversineDistanceM(b, c), 3)
  })
})

describe('fromLocalEastNorthM', () => {
  it('round-trips with haversineDistanceM', () => {
    const origin = { lat: 10, lon: 20 }
    const p = fromLocalEastNorthM(origin, 100, 0)
    expect(haversineDistanceM(origin, p)).toBeCloseTo(100, 0)
  })
})

describe('projectOntoSegment', () => {
  it('is null for a degenerate (near-zero-length) segment', () => {
    expect(projectOntoSegment({ lat: 5, lon: 5 }, LINE_FROM, LINE_FROM)).toBeNull()
  })

  it('reports zero cross-track for a point on the line', () => {
    const proj = projectOntoSegment({ lat: north(100), lon: 0 }, LINE_FROM, LINE_TO)
    expect(proj?.crossTrackM).toBeCloseTo(0, 5)
    expect(proj?.closestDistAlong).toBeCloseTo(100, 5)
  })

  it('clamps closestDistAlong to the segment bounds', () => {
    const before = projectOntoSegment({ lat: north(-50), lon: 0 }, LINE_FROM, LINE_TO)
    expect(before?.closestDistAlong).toBe(0)
    const after = projectOntoSegment({ lat: north(1050), lon: 0 }, LINE_FROM, LINE_TO)
    expect(after?.closestDistAlong).toBeCloseTo(1000, 5)
  })
})

describe('alongTrackFraction', () => {
  it('is 0 at the start of the segment', () => {
    expect(alongTrackFraction(LINE_FROM, LINE_FROM, LINE_TO)).toBeCloseTo(0, 5)
  })

  it('is 1 at the end of the segment', () => {
    expect(alongTrackFraction(LINE_TO, LINE_FROM, LINE_TO)).toBeCloseTo(1, 5)
  })

  it('is ~0.5 halfway along, even when off to the side', () => {
    const halfwayOffTrack = { lat: north(500), lon: east(30) }
    expect(alongTrackFraction(halfwayOffTrack, LINE_FROM, LINE_TO)).toBeCloseTo(0.5, 2)
  })

  it('treats a degenerate segment as fully behind (1)', () => {
    expect(alongTrackFraction({ lat: 5, lon: 5 }, LINE_FROM, LINE_FROM)).toBe(1)
  })
})

describe('segmentsIntersect', () => {
  const p = (lat: number, lon: number) => ({ lat, lon })

  it('detects a crossing', () => {
    expect(segmentsIntersect(p(0, 0), p(1, 1), p(0, 1), p(1, 0))).toBe(true)
  })

  it('ignores parallel and separate segments', () => {
    expect(segmentsIntersect(p(0, 0), p(0, 1), p(1, 0), p(1, 1))).toBe(false)
    expect(segmentsIntersect(p(0, 0), p(1, 1), p(2, 2), p(3, 0))).toBe(false)
  })

  it('counts touching as crossing', () => {
    expect(segmentsIntersect(p(0, 0), p(1, 0), p(1, 0), p(1, 1))).toBe(true)
  })
})

describe('distanceToPolygonEdgeM', () => {
  it('is the distance to the nearest edge', () => {
    const square = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.01 },
      { lat: 0.01, lon: 0.01 },
      { lat: 0.01, lon: 0 },
    ]
    // 0.002° of latitude from the bottom edge ≈ 222.6 m.
    expect(distanceToPolygonEdgeM({ lat: 0.002, lon: 0.005 }, square)).toBeCloseTo(222.6, 0)
  })
})

