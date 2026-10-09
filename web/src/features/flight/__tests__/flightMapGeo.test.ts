import { describe, expect, it } from 'vitest'
import type { Mission } from '../../../domain'
import { fromLocalEastNorthM, haversineDistanceM } from '../../../domain'
import {
  AIRCRAFT_MARKER_MIN_PX,
  aircraftMarkerScale,
  appendTrailPoint,
  buildAircraftMarkerGeoJson,
  buildFenceGeoJson,
  buildFloatingTrailGeoJson,
  buildMissionFloatingPathGeoJson,
  buildMissionLoiterRingLinesGeoJson,
  buildMissionLoiterRingsGeoJson,
  buildMissionPathLinesGeoJson,
  buildMissionWaypointMarkersGeoJson,
  buildMissionWaypointPointsGeoJson,
  buildTrailLineGeoJson,
  isLappingCurrentLoiter,
  metersPerPixel,
  missionBounds,
  MAX_TRAIL_POINTS,
  type AltitudePoint,
} from '../flightMapGeo'

function altPoint(lat: number, lon: number, altM: number): AltitudePoint {
  return { point: { lat, lon }, altM }
}

describe('appendTrailPoint', () => {
  it('appends a point', () => {
    const trail = appendTrailPoint([], altPoint(1, 2, 10))
    expect(trail).toEqual([altPoint(1, 2, 10)])
  })

  it('caps the trail length, dropping the oldest points', () => {
    const trail = Array.from({ length: 5 }, (_, i) => altPoint(i, i, i))
    const next = appendTrailPoint(trail, altPoint(99, 99, 99), 3)

    expect(next).toHaveLength(3)
    expect(next[next.length - 1]).toEqual(altPoint(99, 99, 99))
    expect(next[0]).toEqual(altPoint(3, 3, 3))
  })

  it('defaults to MAX_TRAIL_POINTS', () => {
    const trail = Array.from({ length: MAX_TRAIL_POINTS }, (_, i) => altPoint(i, i, i))
    const next = appendTrailPoint(trail, altPoint(999, 999, 999))
    expect(next).toHaveLength(MAX_TRAIL_POINTS)
  })
})

describe('buildFloatingTrailGeoJson', () => {
  it('is empty with fewer than two points', () => {
    expect(buildFloatingTrailGeoJson([]).features).toEqual([])
    expect(buildFloatingTrailGeoJson([altPoint(0, 0, 10)]).features).toEqual([])
  })

  it('builds one ribbon segment per consecutive pair of trail points', () => {
    const trail = [altPoint(0, 0, 10), altPoint(0, 0.001, 20), altPoint(0, 0.002, 30)]
    expect(buildFloatingTrailGeoJson(trail).features).toHaveLength(2)
  })

  it('floats each segment at the midpoint altitude of its two points', () => {
    const trail = [altPoint(0, 0, 10), altPoint(0, 0.001, 30)]
    const feature = buildFloatingTrailGeoJson(trail).features[0]
    expect(feature?.properties?.base).toBeCloseTo(20 - 0.8, 5)
    expect(feature?.properties?.top).toBeCloseTo(20 + 0.8, 5)
  })

  it('clamps the base at ground level for low altitudes', () => {
    const trail = [altPoint(0, 0, 0.2), altPoint(0, 0.001, 0.2)]
    const feature = buildFloatingTrailGeoJson(trail).features[0]
    expect(feature?.properties?.base).toBe(0)
  })

  it('skips degenerate (identical) consecutive points', () => {
    const trail = [altPoint(0, 0, 10), altPoint(0, 0, 10), altPoint(0, 0.001, 20)]
    expect(buildFloatingTrailGeoJson(trail).features).toHaveLength(1)
  })
})

function mission(overrides: Partial<Mission> = {}): Mission {
  return { id: 'm1', name: 'test', items: [], createdAt: 0, updatedAt: 0, ...overrides }
}

describe('buildMissionFloatingPathGeoJson', () => {
  it('is empty without a mission', () => {
    expect(buildMissionFloatingPathGeoJson(null).features).toEqual([])
  })

  it('is empty with fewer than two altitude-bearing items', () => {
    const m = mission({ items: [{ type: 'vtolTakeoff', altM: 50 }, { type: 'waypoint', lat: 1, lon: 2, altM: 50 }] })
    expect(buildMissionFloatingPathGeoJson(m).features).toEqual([])
  })

  it('produces slabs for each leg, skipping takeoff/RTL', () => {
    const m = mission({
      items: [
        { type: 'vtolTakeoff', altM: 50 },
        { type: 'waypoint', lat: 0, lon: 0.0003, altM: 50 },
        { type: 'loiter', lat: 0, lon: 0.0006, altM: 50, radiusM: 50 },
        { type: 'returnToLaunch' },
      ],
    })
    const collection = buildMissionFloatingPathGeoJson(m)
    expect(collection.features.length).toBeGreaterThan(0)
    for (const f of collection.features) {
      expect(f.properties?.top).toBeGreaterThan(f.properties?.base)
    }
  })

  it('produces a fixed dash length regardless of leg length', () => {
    const short = mission({
      items: [
        { type: 'waypoint', lat: 0, lon: 0, altM: 50 },
        { type: 'waypoint', lat: 0, lon: 0.0003, altM: 50 },
      ],
    })
    const long = mission({
      items: [
        { type: 'waypoint', lat: 0, lon: 0, altM: 50 },
        { type: 'waypoint', lat: 0, lon: 0.003, altM: 50 },
      ],
    })
    // A ~10x longer leg should get ~10x more (still fixed-length) dashes, not
    // a handful of stretched ones.
    const shortCount = buildMissionFloatingPathGeoJson(short).features.length
    const longCount = buildMissionFloatingPathGeoJson(long).features.length
    expect(longCount).toBeGreaterThan(shortCount * 5)
  })

  it('slopes between legs of differing altitude', () => {
    const m = mission({
      items: [
        { type: 'waypoint', lat: 0, lon: 0, altM: 20 },
        { type: 'waypoint', lat: 0, lon: 0.0005, altM: 100 },
      ],
    })
    const tops = buildMissionFloatingPathGeoJson(m).features.map((f) => f.properties?.top as number)
    expect(tops.length).toBeGreaterThan(1)
    expect(Math.min(...tops)).toBeLessThan(30)
    expect(Math.max(...tops)).toBeGreaterThan(90)
    // Monotonically rising along the leg.
    expect(tops).toEqual([...tops].sort((a, b) => a - b))
  })

  it('treats vtolLand as ground level, sloping down to it', () => {
    const m = mission({
      items: [
        { type: 'waypoint', lat: 0, lon: 0, altM: 60 },
        { type: 'vtolLand', lat: 0, lon: 0.0005 },
      ],
    })
    const tops = buildMissionFloatingPathGeoJson(m).features.map((f) => f.properties?.top as number)
    expect(Math.min(...tops)).toBeLessThan(10)
  })

  it('prepends a leg from fromPoint to the first mission item', () => {
    const m = mission({ items: [{ type: 'waypoint', lat: 0, lon: 0.0008, altM: 80 }] })
    const fromPoint = { point: { lat: 0, lon: 0 }, altM: 0 }
    const withStart = buildMissionFloatingPathGeoJson(m, fromPoint)
    const withoutStart = buildMissionFloatingPathGeoJson(m)
    expect(withStart.features.length).toBeGreaterThan(withoutStart.features.length)
    const tops = withStart.features.map((f) => f.properties?.top as number)
    expect(Math.min(...tops)).toBeLessThan(10)
    expect(Math.max(...tops)).toBeGreaterThan(70)
  })

  it('ignores fromPoint when the mission has no altitude-bearing items yet', () => {
    const m = mission({ items: [{ type: 'vtolTakeoff', altM: 50 }, { type: 'returnToLaunch' }] })
    const fromPoint = { point: { lat: 0, lon: 0 }, altM: 0 }
    expect(buildMissionFloatingPathGeoJson(m, fromPoint).features).toEqual([])
  })

  describe('clearedBeforeIndex', () => {
    function twoLegMission(): Mission {
      return mission({
        items: [
          { type: 'vtolTakeoff', altM: 50 },
          { type: 'waypoint', lat: 0, lon: 0.0005, altM: 50 },
          { type: 'waypoint', lat: 0, lon: 0.001, altM: 50 },
        ],
      })
    }
    const fromPoint = { point: { lat: 0, lon: 0 }, altM: 0 }

    it('keeps the full path when nothing has been cleared yet', () => {
      const m = twoLegMission()
      const full = buildMissionFloatingPathGeoJson(m, fromPoint)
      const atZero = buildMissionFloatingPathGeoJson(m, fromPoint, 0)
      expect(atZero.features.length).toBe(full.features.length)
    })

    it('drops the home -> first-waypoint leg once that waypoint is cleared', () => {
      const m = twoLegMission()
      const full = buildMissionFloatingPathGeoJson(m, fromPoint)
      // missionProgress.currentIndex = 2 means item 1 (the first waypoint) is behind it.
      const partial = buildMissionFloatingPathGeoJson(m, fromPoint, 2)
      expect(partial.features.length).toBeGreaterThan(0)
      expect(partial.features.length).toBeLessThan(full.features.length)
    })

    it('drops every leg once clearedBeforeIndex is past the whole mission', () => {
      const m = twoLegMission()
      expect(buildMissionFloatingPathGeoJson(m, fromPoint, 99).features).toEqual([])
    })
  })

  describe('dronePosition (progressive trim)', () => {
    function twoLegMission(): Mission {
      return mission({
        items: [
          { type: 'vtolTakeoff', altM: 50 },
          { type: 'waypoint', lat: 0, lon: 0.0005, altM: 50 },
          { type: 'waypoint', lat: 0, lon: 0.001, altM: 50 },
        ],
      })
    }
    const fromPoint = { point: { lat: 0, lon: 0 }, altM: 0 }

    it('trims more of the current leg the further the drone has flown along it', () => {
      const m = twoLegMission()
      const atStart = buildMissionFloatingPathGeoJson(m, fromPoint, 1, { lat: 0, lon: 0 })
      const quarter = buildMissionFloatingPathGeoJson(m, fromPoint, 1, { lat: 0, lon: 0.000125 })
      const half = buildMissionFloatingPathGeoJson(m, fromPoint, 1, { lat: 0, lon: 0.00025 })
      expect(quarter.features.length).toBeLessThan(atStart.features.length)
      expect(half.features.length).toBeLessThan(quarter.features.length)
    })

    it('fully trims a leg once the drone reaches its endpoint', () => {
      const m = mission({ items: [{ type: 'vtolTakeoff', altM: 50 }, { type: 'waypoint', lat: 0, lon: 0.0005, altM: 50 }] })
      const atEnd = buildMissionFloatingPathGeoJson(m, fromPoint, 1, { lat: 0, lon: 0.0005 })
      expect(atEnd.features).toEqual([])
    })

    it('only trims the current leg, leaving the next leg fully intact', () => {
      const m = twoLegMission()
      // Drone at the end of leg 1 (-> fully trimmed); leg 2 isn't "current" (destination itemIndex 2 !== clearedBeforeIndex 1).
      const droneAtEndOfLeg1 = buildMissionFloatingPathGeoJson(m, fromPoint, 1, { lat: 0, lon: 0.0005 })
      // Equivalent reference: drop leg 1 outright via clearedBeforeIndex, keep leg 2 in full.
      const leg2Only = buildMissionFloatingPathGeoJson(m, fromPoint, 2)
      expect(droneAtEndOfLeg1.features.length).toBe(leg2Only.features.length)
    })

    it('renders the current leg in full when dronePosition is omitted', () => {
      const m = twoLegMission()
      const withoutDrone = buildMissionFloatingPathGeoJson(m, fromPoint, 1)
      const full = buildMissionFloatingPathGeoJson(m, fromPoint)
      expect(withoutDrone.features.length).toBe(full.features.length)
    })
  })
})

describe('buildAircraftMarkerGeoJson', () => {
  it('is empty without a pose', () => {
    expect(buildAircraftMarkerGeoJson(null).features).toEqual([])
  })

  it('floats the marker at altitude rather than reaching down to the ground', () => {
    const feature = buildAircraftMarkerGeoJson({ point: { lat: 0, lon: 0 }, altM: 50, headingDeg: 0 }).features[0]
    expect(feature?.properties?.base).toBeGreaterThan(0)
    expect(feature?.properties?.top).toBeGreaterThan(feature?.properties?.base)
  })

  it('clamps the base at ground level for low altitudes', () => {
    const feature = buildAircraftMarkerGeoJson({ point: { lat: 0, lon: 0 }, altM: 0.5, headingDeg: 0 }).features[0]
    expect(feature?.properties?.base).toBe(0)
  })

  it('closes the triangle ring', () => {
    const ring = buildAircraftMarkerGeoJson({ point: { lat: 0, lon: 0 }, altM: 50, headingDeg: 0 }).features[0]?.geometry
      .coordinates[0]
    expect(ring).toHaveLength(4)
    expect(ring?.[0]).toEqual(ring?.[3])
  })

  it('points the nose north when headingDeg is 0', () => {
    const ring = buildAircraftMarkerGeoJson({ point: { lat: 0, lon: 0 }, altM: 50, headingDeg: 0 }).features[0]?.geometry
      .coordinates[0]
    const nose = ring?.[0]
    expect(nose?.[1]).toBeGreaterThan(0) // further north (higher lat) than center
    expect(nose?.[0]).toBeCloseTo(0, 6) // same longitude as center
  })

  it('points the nose east when headingDeg is 90', () => {
    const ring = buildAircraftMarkerGeoJson({ point: { lat: 0, lon: 0 }, altM: 50, headingDeg: 90 }).features[0]?.geometry
      .coordinates[0]
    const nose = ring?.[0]
    expect(nose?.[0]).toBeGreaterThan(0) // further east (higher lon) than center
    expect(nose?.[1]).toBeCloseTo(0, 6) // same latitude as center
  })

  it('scales the footprint but not the altitude', () => {
    const pose = { point: { lat: 0, lon: 0 }, altM: 50, headingDeg: 0 }
    const base = buildAircraftMarkerGeoJson(pose).features[0]
    const big = buildAircraftMarkerGeoJson(pose, 3).features[0]
    expect(big?.geometry.coordinates[0]?.[0]?.[1]).toBeCloseTo((base?.geometry.coordinates[0]?.[0]?.[1] ?? 0) * 3, 9)
    expect(big?.properties).toEqual(base?.properties)
  })
})

describe('aircraftMarkerScale', () => {
  it('enlarges the marker to the minimum on-screen size when zoomed out', () => {
    // Zoom 16 at the equator: ~1.19 m/px, so an 8m marker is ~6.7px unscaled.
    const scale = aircraftMarkerScale(16, 0)
    const metersPerPx = 40_075_016.686 / (512 * 2 ** 16)
    expect((8 * scale) / metersPerPx).toBeCloseTo(AIRCRAFT_MARKER_MIN_PX, 6)
  })

  it('stays at true scale once zoomed in past the minimum', () => {
    expect(aircraftMarkerScale(22, 0)).toBe(1)
  })

  it('grows as the map zooms out', () => {
    expect(aircraftMarkerScale(12, -37.86)).toBeGreaterThan(aircraftMarkerScale(16, -37.86))
  })
})

describe('buildMissionWaypointMarkersGeoJson', () => {
  it('is empty without a mission', () => {
    expect(buildMissionWaypointMarkersGeoJson(null).features).toEqual([])
  })

  it('builds one marker per waypoint/loiter item, skipping takeoff/RTL/land', () => {
    const m = mission({
      items: [
        { type: 'vtolTakeoff', altM: 50 },
        { type: 'waypoint', lat: 1, lon: 2, altM: 60 },
        { type: 'loiter', lat: 3, lon: 4, altM: 70, radiusM: 50 },
        { type: 'vtolLand', lat: 5, lon: 6 },
        { type: 'returnToLaunch' },
      ],
    })
    const collection = buildMissionWaypointMarkersGeoJson(m)
    expect(collection.features).toHaveLength(2)
    expect(collection.features.map((f) => f.properties?.base)).toEqual([60, 70].map((alt) => alt - 1.5))
    expect(collection.features.map((f) => f.properties?.top)).toEqual([60, 70].map((alt) => alt + 1.5))
  })

  it('floats the marker at altitude rather than reaching down to the ground', () => {
    const m = mission({ items: [{ type: 'waypoint', lat: 0, lon: 0, altM: 50 }] })
    const feature = buildMissionWaypointMarkersGeoJson(m).features[0]
    expect(feature?.properties?.base).toBeGreaterThan(0)
  })

  it('clamps the base at ground level for low altitudes', () => {
    const m = mission({ items: [{ type: 'waypoint', lat: 0, lon: 0, altM: 1 }] })
    const feature = buildMissionWaypointMarkersGeoJson(m).features[0]
    expect(feature?.properties?.base).toBe(0)
  })

  it('centers each marker square footprint on the item location', () => {
    const m = mission({ items: [{ type: 'waypoint', lat: 10, lon: 20, altM: 50 }] })
    const ring = buildMissionWaypointMarkersGeoJson(m).features[0]?.geometry.coordinates[0]
    expect(ring).toHaveLength(5)
    const lons = ring?.map((c) => c[0] ?? 0) ?? []
    const lats = ring?.map((c) => c[1] ?? 0) ?? []
    expect(Math.min(...lons)).toBeLessThan(20)
    expect(Math.max(...lons)).toBeGreaterThan(20)
    expect(Math.min(...lats)).toBeLessThan(10)
    expect(Math.max(...lats)).toBeGreaterThan(10)
  })

  describe('clearedBeforeIndex', () => {
    function twoWaypointMission(): Mission {
      return mission({
        items: [
          { type: 'vtolTakeoff', altM: 50 },
          { type: 'waypoint', lat: 0, lon: 0.0005, altM: 50 },
          { type: 'waypoint', lat: 0, lon: 0.001, altM: 50 },
          { type: 'returnToLaunch' },
        ],
      })
    }

    const done = (cleared?: number) =>
      buildMissionWaypointMarkersGeoJson(twoWaypointMission(), cleared).features.map((f) => f.properties?.done)

    it('marks nothing done before the vehicle has flown through anything', () => {
      expect(done(0)).toEqual([false, false])
      expect(done(undefined)).toEqual([false, false])
    })

    it('keeps a waypoint the vehicle has flown through, marked done', () => {
      // missionProgress.currentIndex = 2 means item 1 (the first waypoint) is behind it.
      expect(done(2)).toEqual([true, false])
    })

    it('marks every waypoint done once the whole mission is past', () => {
      expect(done(99)).toEqual([true, true])
    })
  })
})

describe('isLappingCurrentLoiter', () => {
  const center = { lat: 0, lon: 0.01 }
  const m = mission({
    items: [
      { type: 'vtolTakeoff', altM: 50 },
      { type: 'loiter', ...center, altM: 50, radiusM: 60 },
      { type: 'returnToLaunch' },
    ],
  })
  const metresEastOfCenter = (metres: number) => ({ lat: 0, lon: 0.01 + metres / 111_320 })

  it('is true once the drone is on the circle of the loiter it is currently flying', () => {
    expect(isLappingCurrentLoiter(m, 1, metresEastOfCenter(60))).toBe(true)
  })

  it('is false while still approaching the circle', () => {
    expect(isLappingCurrentLoiter(m, 1, metresEastOfCenter(150))).toBe(false)
  })

  it('is false when the current item is not a loiter', () => {
    expect(isLappingCurrentLoiter(m, 2, metresEastOfCenter(60))).toBe(false)
  })
})

describe('buildMissionLoiterRingsGeoJson', () => {
  it('is empty without a mission', () => {
    expect(buildMissionLoiterRingsGeoJson(null).features).toEqual([])
  })

  it('is empty with no loiter items', () => {
    const m = mission({ items: [{ type: 'waypoint', lat: 0, lon: 0, altM: 50 }] })
    expect(buildMissionLoiterRingsGeoJson(m).features).toEqual([])
  })

  it('builds dash segments for a loiter item, each floating at its altitude', () => {
    const m = mission({ items: [{ type: 'loiter', lat: 0, lon: 0, altM: 50, radiusM: 50 }] })
    const collection = buildMissionLoiterRingsGeoJson(m)
    expect(collection.features.length).toBeGreaterThan(1)
    for (const f of collection.features) {
      expect(f.properties?.base).toBeCloseTo(50 - 0.6, 5)
      expect(f.properties?.top).toBeCloseTo(50 + 0.6, 5)
    }
  })

  it('every dash sits approximately radiusM from the loiter center', () => {
    const center = { lat: 10, lon: 20 }
    const m = mission({ items: [{ type: 'loiter', lat: center.lat, lon: center.lon, altM: 50, radiusM: 80 }] })
    const collection = buildMissionLoiterRingsGeoJson(m)
    for (const f of collection.features) {
      for (const coord of f.geometry.coordinates[0] ?? []) {
        const [lon, lat] = coord
        expect(haversineDistanceM({ lat: lat ?? 0, lon: lon ?? 0 }, center)).toBeCloseTo(80, -1)
      }
    }
  })

  it('a larger radius produces more dashes (longer circumference)', () => {
    const small = mission({ items: [{ type: 'loiter', lat: 0, lon: 0, altM: 50, radiusM: 20 }] })
    const large = mission({ items: [{ type: 'loiter', lat: 0, lon: 0, altM: 50, radiusM: 200 }] })
    expect(buildMissionLoiterRingsGeoJson(large).features.length).toBeGreaterThan(buildMissionLoiterRingsGeoJson(small).features.length)
  })

  describe('clearedBeforeIndex', () => {
    function missionWithLoiterAt(index: number): Mission {
      const items: Mission['items'] =
        index === 1
          ? [{ type: 'vtolTakeoff', altM: 50 }, { type: 'loiter', lat: 0, lon: 0, altM: 50, radiusM: 50 }]
          : [{ type: 'loiter', lat: 0, lon: 0, altM: 50, radiusM: 50 }]
      return mission({ items })
    }

    it('keeps the ring when not yet cleared', () => {
      const m = missionWithLoiterAt(1)
      expect(buildMissionLoiterRingsGeoJson(m, 1).features.length).toBeGreaterThan(0)
    })

    it('drops the ring once the vehicle has flown past the loiter item', () => {
      const m = missionWithLoiterAt(1)
      expect(buildMissionLoiterRingsGeoJson(m, 2).features).toEqual([])
    })
  })
})

describe('buildFenceGeoJson', () => {
  it('is null without a fence', () => {
    expect(buildFenceGeoJson(mission())).toBeNull()
  })

  it('is null with fewer than three points', () => {
    const m = mission({ fence: { polygon: [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }] } })
    expect(buildFenceGeoJson(m)).toBeNull()
  })

  it('closes the ring if not already closed', () => {
    const m = mission({
      fence: {
        polygon: [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 1 },
          { lat: 1, lon: 1 },
        ],
      },
    })
    const feature = buildFenceGeoJson(m)
    const ring = feature?.geometry.coordinates[0]
    expect(ring?.[0]).toEqual(ring?.[ring.length - 1])
    expect(ring).toHaveLength(4)
  })
})

describe('metersPerPixel', () => {
  it('matches MapLibre’s 512px world at zoom 0 and halves with each zoom level', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(40_075_016.686 / 512, 6)
    expect(metersPerPixel(13, 0)).toBeCloseTo(metersPerPixel(12, 0) / 2, 9)
  })
})

describe('overlay sizing when zoomed out', () => {
  const M_PER_DEG = 111_320
  // Zoom 12 at the equator: ~19m per pixel — far enough out that the
  // true-scale overlays (1.2m-wide path, 4m waypoint blocks) are sub-pixel.
  const zoomedOut = metersPerPixel(12, 0)
  const zoomedIn = 0.01

  function latSpanM(feature: { geometry: { coordinates: number[][][] } } | undefined): number {
    const lats = feature?.geometry.coordinates[0]?.map((c) => c[1] ?? 0) ?? []
    return (Math.max(...lats) - Math.min(...lats)) * M_PER_DEG
  }

  it('keeps waypoint blocks at least 12px across', () => {
    const m = mission({ items: [{ type: 'waypoint', lat: 0, lon: 0, altM: 50 }] })
    const out = buildMissionWaypointMarkersGeoJson(m, undefined, zoomedOut).features[0]
    expect(latSpanM(out) / zoomedOut).toBeCloseTo(12, 1)
    // Up close the real 4m size already exceeds 12px, so it's left alone.
    const near = buildMissionWaypointMarkersGeoJson(m, undefined, zoomedIn).features[0]
    expect(latSpanM(near)).toBeCloseTo(4, 1)
  })

  it('keeps the path at least 3px wide, with fewer, longer dashes', () => {
    // A 2km east-west leg along the equator, so a dash's width is all latitude.
    const m = mission({ items: [{ type: 'waypoint', lat: 0, lon: 0, altM: 50 }, { type: 'waypoint', lat: 0, lon: 2000 / M_PER_DEG, altM: 50 }] })
    const trueScale = buildMissionFloatingPathGeoJson(m).features
    const out = buildMissionFloatingPathGeoJson(m, undefined, undefined, undefined, zoomedOut).features
    expect(latSpanM(out[0]) / zoomedOut).toBeCloseTo(3, 1)
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeLessThan(trueScale.length)
  })

  it('keeps altitudes unscaled', () => {
    const m = mission({ items: [{ type: 'waypoint', lat: 0, lon: 0, altM: 50 }, { type: 'waypoint', lat: 0, lon: 0.01, altM: 50 }] })
    const near = buildMissionFloatingPathGeoJson(m).features[0]?.properties
    const out = buildMissionFloatingPathGeoJson(m, undefined, undefined, undefined, zoomedOut).features[0]?.properties
    expect(out).toEqual(near)
  })

  it('keeps the loiter ring at least 3px wide', () => {
    const m = mission({ items: [{ type: 'loiter', lat: 0, lon: 0, altM: 50, radiusM: 2000 }] })
    const widths = buildMissionLoiterRingsGeoJson(m, undefined, zoomedOut).features.map((f) => {
      // A dash at the ring's top or bottom runs east-west, so its width is its lat span.
      const lats = f.geometry.coordinates[0]?.map((c) => c[1] ?? 0) ?? []
      return { midLat: (Math.max(...lats) + Math.min(...lats)) / 2, spanM: latSpanM(f) }
    })
    const top = widths.reduce((a, b) => (b.midLat > a.midLat ? b : a))
    expect(top.spanM / zoomedOut).toBeGreaterThanOrEqual(3 - 0.1)
  })

  it('keeps the flown trail at least 3px wide', () => {
    const trail = [altPoint(0, 0, 50), altPoint(0, 2000 / M_PER_DEG, 50)]
    const out = buildFloatingTrailGeoJson(trail, zoomedOut).features[0]
    expect(latSpanM(out) / zoomedOut).toBeCloseTo(3, 1)
  })
})

describe('flat (zoomed-out) overlays', () => {
  const twoLegs = () =>
    mission({
      items: [
        { type: 'vtolTakeoff', altM: 40 },
        { type: 'waypoint', lat: 0, lon: 0.01, altM: 50 },
        { type: 'loiter', lat: 0, lon: 0.02, altM: 60, radiusM: 80 },
        { type: 'returnToLaunch' },
      ],
    })
  const home = altPoint(0, 0, 0)

  it('draws the trail as one line, or nothing with fewer than two points', () => {
    expect(buildTrailLineGeoJson([altPoint(0, 0, 50)]).features).toEqual([])
    const line = buildTrailLineGeoJson([altPoint(0, 0, 50), altPoint(0, 0.001, 50), altPoint(0, 0.002, 50)]).features[0]
    expect(line?.geometry.coordinates).toEqual([[0, 0], [0.001, 0], [0.002, 0]])
  })

  it('draws a point per waypoint/loiter, marking ones already flown through done', () => {
    expect(buildMissionWaypointPointsGeoJson(twoLegs()).features.map((f) => f.geometry.coordinates)).toEqual([[0.01, 0], [0.02, 0]])
    expect(buildMissionWaypointPointsGeoJson(twoLegs(), 2).features.map((f) => f.properties?.done)).toEqual([true, false])
  })

  it('draws a line per leg from home, dropping cleared legs', () => {
    const legs = buildMissionPathLinesGeoJson(twoLegs(), home).features
    expect(legs.map((f) => f.geometry.coordinates)).toEqual([[[0, 0], [0.01, 0]], [[0.01, 0], [0.02, 0]]])
    expect(buildMissionPathLinesGeoJson(twoLegs(), home, 2).features).toHaveLength(1)
  })

  it('starts the current leg at the drone instead of its origin', () => {
    // Halfway along the leg from waypoint (index 1) to loiter (index 2).
    const legs = buildMissionPathLinesGeoJson(twoLegs(), home, 2, { lat: 0, lon: 0.015 }).features
    expect(legs).toHaveLength(1)
    expect(legs[0]?.geometry.coordinates[0]?.[0]).toBeCloseTo(0.015, 6)
    expect(legs[0]?.geometry.coordinates[1]).toEqual([0.02, 0])
  })

  it('keeps the current leg on the planned line when the drone is off it', () => {
    // The dashed path is the fixed ideal route; the aircraft moving off it
    // (wind, a pause) trims it by along-track progress, never drags it along.
    const offLeg = { lat: -0.001, lon: 0.015 } // ~110 m south, halfway along
    const legs = buildMissionPathLinesGeoJson(twoLegs(), home, 2, offLeg).features
    expect(legs[0]?.geometry.coordinates[0]?.[0]).toBeCloseTo(0.015, 6)
    expect(legs[0]?.geometry.coordinates[0]?.[1]).toBeCloseTo(0, 9) // still on the leg, not at the drone
    expect(legs[0]?.geometry.coordinates[1]).toEqual([0.02, 0])
  })

  it('draws each loiter as a closed circle at its radius', () => {
    const ring = buildMissionLoiterRingLinesGeoJson(twoLegs()).features[0]?.geometry.coordinates ?? []
    expect(ring[0]).toEqual(ring[ring.length - 1])
    for (const [lon, lat] of ring) {
      expect(haversineDistanceM({ lat: lat ?? 0, lon: lon ?? 0 }, { lat: 0, lon: 0.02 })).toBeCloseTo(80, 0)
    }
    expect(buildMissionLoiterRingLinesGeoJson(twoLegs(), 3).features).toEqual([])
  })
})

describe('missionBounds', () => {
  const home = { lat: -37.861, lon: 145.062 }
  const at = (eastM: number, northM: number) => fromLocalEastNorthM(home, eastM, northM)
  const missionWith = (items: Mission['items']): Mission => ({ id: 'm', name: 'm', items, createdAt: 0, updatedAt: 0 })

  it('spans every item, home and the drone', () => {
    const m = missionWith([{ type: 'vtolTakeoff', altM: 40 }, { type: 'waypoint', ...at(3000, 2000), altM: 60 }, { type: 'returnToLaunch' }])
    const drone = at(-500, -800)
    const [[w, s], [e, n]] = missionBounds(m, home, drone)!
    expect(w).toBeCloseTo(drone.lon, 9)
    expect(s).toBeCloseTo(drone.lat, 9)
    expect(e).toBeCloseTo(at(3000, 0).lon, 9)
    expect(n).toBeCloseTo(at(0, 2000).lat, 9)
  })

  it('reaches the outer edge of a loiter circle', () => {
    const m = missionWith([{ type: 'loiter', ...at(1000, 0), altM: 60, radiusM: 500, turns: 1 }])
    const [[w], [e]] = missionBounds(m, null, null)!
    expect(w).toBeCloseTo(at(500, 0).lon, 6)
    expect(e).toBeCloseTo(at(1500, 0).lon, 6)
  })

  it('is null with nothing to show', () => {
    expect(missionBounds(null, null, null)).toBeNull()
  })
})
