import type { Feature, FeatureCollection, Polygon } from 'geojson'
import { alongTrackFraction, fromLocalEastNorthM, haversineDistanceM, type GeoPoint, type Mission } from '../../domain'

export const MAX_TRAIL_POINTS = 500

export interface AltitudePoint {
  point: GeoPoint
  altM: number
}

export function appendTrailPoint(trail: AltitudePoint[], point: AltitudePoint, max = MAX_TRAIL_POINTS): AltitudePoint[] {
  const next = [...trail, point]
  return next.length > max ? next.slice(next.length - max) : next
}

function metersToDegreesAt(lat: number, meters: number): { dLat: number; dLon: number } {
  return {
    dLat: meters / 111_320,
    dLon: meters / (111_320 * Math.cos((lat * Math.PI) / 180)),
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

const TRAIL_HALF_WIDTH_M = 0.8
const TRAIL_HALF_THICKNESS_M = 0.8

/** The drone's actual flown path, floating at its real recorded altitude
 * instead of flat on the ground — same `fill-extrusion` ribbon technique as
 * the planned path, but solid (not dashed, to read as "where it's been"
 * rather than "where it's going") and built straight from the recorded
 * trail points rather than interpolated along a prescribed line, since
 * telemetry is already sampled every tick. */
export function buildFloatingTrailGeoJson(trail: AltitudePoint[]): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = []

  for (let i = 0; i < trail.length - 1; i++) {
    const a = trail[i]
    const b = trail[i + 1]
    if (!a || !b) continue

    const dLon = b.point.lon - a.point.lon
    const dLat = b.point.lat - a.point.lat
    const len = Math.hypot(dLon, dLat)
    if (len === 0) continue

    const { dLat: halfWidthLat, dLon: halfWidthLon } = metersToDegreesAt((a.point.lat + b.point.lat) / 2, TRAIL_HALF_WIDTH_M)
    const perpLon = (-dLat / len) * halfWidthLon
    const perpLat = (dLon / len) * halfWidthLat

    const ring: [number, number][] = [
      [a.point.lon - perpLon, a.point.lat - perpLat],
      [b.point.lon - perpLon, b.point.lat - perpLat],
      [b.point.lon + perpLon, b.point.lat + perpLat],
      [a.point.lon + perpLon, a.point.lat + perpLat],
      [a.point.lon - perpLon, a.point.lat - perpLat],
    ]

    const altMid = (a.altM + b.altM) / 2
    features.push({
      type: 'Feature',
      properties: {
        base: Math.max(0, altMid - TRAIL_HALF_THICKNESS_M),
        top: altMid + TRAIL_HALF_THICKNESS_M,
      },
      geometry: { type: 'Polygon', coordinates: [ring] },
    })
  }

  return { type: 'FeatureCollection', features }
}

const WAYPOINT_MARKER_HALF_WIDTH_M = 2
const WAYPOINT_MARKER_HALF_THICKNESS_M = 1.5

/** MapLibre's line/marker primitives have no altitude, so each waypoint/
 * loiter item gets a small `fill-extrusion` block hovering at its altM — a
 * thin slab (base/top bracket altM), not a column down to the ground, so it
 * reads as a marker floating in place rather than a post. Same mechanism as
 * the 3D buildings; only visible once the camera is tilted off straight-down.
 *
 * `clearedBeforeIndex`, when given, drops markers before that mission.items
 * index — i.e. a waypoint disappears once the vehicle has flown through it,
 * same as the floating path's already-flown legs (buildMissionFloatingPathGeoJson). */
export function buildMissionWaypointMarkersGeoJson(mission: Mission | null, clearedBeforeIndex?: number): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = []

  for (const [itemIndex, item] of (mission?.items ?? []).entries()) {
    if (item.type !== 'waypoint' && item.type !== 'loiter') continue
    if (clearedBeforeIndex !== undefined && itemIndex < clearedBeforeIndex) continue

    const { dLat, dLon } = metersToDegreesAt(item.lat, WAYPOINT_MARKER_HALF_WIDTH_M)
    const ring: [number, number][] = [
      [item.lon - dLon, item.lat - dLat],
      [item.lon + dLon, item.lat - dLat],
      [item.lon + dLon, item.lat + dLat],
      [item.lon - dLon, item.lat + dLat],
      [item.lon - dLon, item.lat - dLat],
    ]

    features.push({
      type: 'Feature',
      properties: {
        base: Math.max(0, item.altM - WAYPOINT_MARKER_HALF_THICKNESS_M),
        top: item.altM + WAYPOINT_MARKER_HALF_THICKNESS_M,
      },
      geometry: { type: 'Polygon', coordinates: [ring] },
    })
  }

  return { type: 'FeatureCollection', features }
}

interface IndexedAltitudePoint extends AltitudePoint {
  /** Index into mission.items this point came from — lets the path builder
   * below tell which leg a given mission item's "cleared" status covers. */
  itemIndex: number
}

/** Mission items that carry a lat/lon, in mission order, each paired with its
 * altitude — vtolLand has no explicit altM (it's a ground-level item), so it's
 * treated as 0. */
function missionAltitudePoints(mission: Mission | null): IndexedAltitudePoint[] {
  const points: IndexedAltitudePoint[] = []
  mission?.items.forEach((item, itemIndex) => {
    switch (item.type) {
      case 'waypoint':
      case 'loiter':
        points.push({ point: { lat: item.lat, lon: item.lon }, altM: item.altM, itemIndex })
        break
      case 'vtolLand':
        points.push({ point: { lat: item.lat, lon: item.lon }, altM: 0, itemIndex })
        break
      case 'vtolTakeoff':
      case 'returnToLaunch':
        break
    }
  })
  return points
}

const FLOATING_PATH_DASH_LENGTH_M = 3
const FLOATING_PATH_GAP_LENGTH_M = 3
const FLOATING_PATH_HALF_WIDTH_M = 0.6
const FLOATING_PATH_HALF_THICKNESS_M = 0.6
/** Safety cap, independent of leg length — without this, a pathologically
 * long leg (e.g. a stale saved mission's waypoint ending up continents away
 * from a newly-changed home position) turns into millions of dash-polygon
 * iterations on every telemetry tick and freezes the tab. A capped leg just
 * shows dashes for its first ~3km rather than the whole thing — an edge
 * case that shouldn't occur in normal use, not a visual concern worth more
 * complexity to handle gracefully. */
const FLOATING_PATH_MAX_DASHES_PER_LEG = 500

/** The planned-path overlay, floating at each leg's altitude instead of flat
 * on the ground — same `fill-extrusion` trick as the altitude posts: each leg
 * between two altitude-bearing items is walked in fixed-length (not
 * fixed-count) dash/gap steps, each dash rendered as a thin slab hovering at
 * its own interpolated altitude, so a long leg gets proportionally more
 * (still constant-length) dashes instead of a few stretched ones, and the
 * slope reads as smoothly rising/falling rather than in big steps.
 *
 * `fromPoint`, when given, is prepended as the start of the first leg — pass
 * a *fixed* point (e.g. home), not the vehicle's live position, or the whole
 * leg redraws itself every tick and looks like it's chasing the drone around
 * instead of being a stable reference line.
 *
 * `clearedBeforeIndex`, when given, drops any leg whose destination item is
 * before that mission.items index — i.e. legs the vehicle has already flown
 * entirely past disappear instead of lingering, dashed, behind it.
 *
 * `dronePosition`, when given, progressively erases the *current* leg (the
 * one whose destination item is `clearedBeforeIndex`) as the vehicle flies
 * along it — each dash behind the aircraft's along-track projection (the
 * point on the leg perpendicular to its position, same projection L1
 * guidance uses) is dropped, so the path trails away in real time instead of
 * vanishing all at once only once the waypoint is finally reached. */
export function buildMissionFloatingPathGeoJson(
  mission: Mission | null,
  fromPoint?: AltitudePoint,
  clearedBeforeIndex?: number,
  dronePosition?: GeoPoint,
): FeatureCollection<Polygon> {
  const missionPoints = missionAltitudePoints(mission)
  const altPoints: IndexedAltitudePoint[] =
    fromPoint && missionPoints.length > 0 ? [{ ...fromPoint, itemIndex: -1 }, ...missionPoints] : missionPoints
  const features: Feature<Polygon>[] = []

  for (let i = 0; i < altPoints.length - 1; i++) {
    const a = altPoints[i]
    const b = altPoints[i + 1]
    if (!a || !b) continue
    if (clearedBeforeIndex !== undefined && b.itemIndex < clearedBeforeIndex) continue

    const legLengthM = haversineDistanceM(a.point, b.point)
    if (legLengthM === 0) continue

    const isCurrentLeg = dronePosition !== undefined && b.itemIndex === clearedBeforeIndex
    const behindFraction = isCurrentLeg && dronePosition ? alongTrackFraction(dronePosition, a.point, b.point) : 0

    const periodM = FLOATING_PATH_DASH_LENGTH_M + FLOATING_PATH_GAP_LENGTH_M
    const dashCount = Math.min(FLOATING_PATH_MAX_DASHES_PER_LEG, Math.max(1, Math.floor(legLengthM / periodM)))

    for (let d = 0; d < dashCount; d++) {
      const startM = d * periodM
      const endM = Math.min(legLengthM, startM + FLOATING_PATH_DASH_LENGTH_M)
      const t0 = startM / legLengthM
      const t1 = endM / legLengthM
      if (t1 <= behindFraction) continue

      const lon0 = lerp(a.point.lon, b.point.lon, t0)
      const lat0 = lerp(a.point.lat, b.point.lat, t0)
      const lon1 = lerp(a.point.lon, b.point.lon, t1)
      const lat1 = lerp(a.point.lat, b.point.lat, t1)
      const altMid = lerp(a.altM, b.altM, (t0 + t1) / 2)

      const dLon = lon1 - lon0
      const dLat = lat1 - lat0
      const len = Math.hypot(dLon, dLat) || 1
      const { dLat: halfWidthLat, dLon: halfWidthLon } = metersToDegreesAt((lat0 + lat1) / 2, FLOATING_PATH_HALF_WIDTH_M)
      const perpLon = (-dLat / len) * halfWidthLon
      const perpLat = (dLon / len) * halfWidthLat

      const ring: [number, number][] = [
        [lon0 - perpLon, lat0 - perpLat],
        [lon1 - perpLon, lat1 - perpLat],
        [lon1 + perpLon, lat1 + perpLat],
        [lon0 + perpLon, lat0 + perpLat],
        [lon0 - perpLon, lat0 - perpLat],
      ]

      features.push({
        type: 'Feature',
        properties: {
          base: Math.max(0, altMid - FLOATING_PATH_HALF_THICKNESS_M),
          top: altMid + FLOATING_PATH_HALF_THICKNESS_M,
        },
        geometry: { type: 'Polygon', coordinates: [ring] },
      })
    }
  }

  return { type: 'FeatureCollection', features }
}

/** How far outside a loiter's radius still counts as "on the circle". */
const LAPPING_MARGIN_M = 25

/** Whether the drone has started lapping the loiter it's currently on —
 * i.e. reached the circle itself, not just heading toward it. */
export function isLappingCurrentLoiter(mission: Mission | null, currentIndex: number, dronePosition: GeoPoint): boolean {
  const item = mission?.items[currentIndex]
  if (item?.type !== 'loiter') return false
  return haversineDistanceM(dronePosition, { lat: item.lat, lon: item.lon }) <= item.radiusM + LAPPING_MARGIN_M
}

const LOITER_RING_DASH_LENGTH_M = 3
const LOITER_RING_GAP_LENGTH_M = 3
const LOITER_RING_HALF_WIDTH_M = 0.6
const LOITER_RING_HALF_THICKNESS_M = 0.6

function pointOnCircle(center: GeoPoint, angleDeg: number, radiusM: number): GeoPoint {
  const angleRad = (angleDeg * Math.PI) / 180
  return fromLocalEastNorthM(center, radiusM * Math.sin(angleRad), radiusM * Math.cos(angleRad))
}

/** The loiter-circle overlay: each loiter item's orbit traced as a dashed
 * ring at its own altitude — same fixed-length dash/gap `fill-extrusion`
 * ribbon technique as the planned path above (including reusing its
 * dash-count safety cap), just walked around the circle's circumference
 * instead of along a straight leg. Rendered as a separate source/color in
 * FlightMap.tsx (green, not the path's purple) so a loiter's lap reads as
 * visually distinct from the straight transit legs into and out of it.
 *
 * `clearedBeforeIndex`, when given, drops a loiter's ring once the vehicle
 * has flown past it, same convention as the other mission overlays. */
export function buildMissionLoiterRingsGeoJson(mission: Mission | null, clearedBeforeIndex?: number): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = []

  for (const [itemIndex, item] of (mission?.items ?? []).entries()) {
    if (item.type !== 'loiter') continue
    if (clearedBeforeIndex !== undefined && itemIndex < clearedBeforeIndex) continue

    const center: GeoPoint = { lat: item.lat, lon: item.lon }
    const circumferenceM = 2 * Math.PI * item.radiusM
    if (circumferenceM === 0) continue

    const periodM = LOITER_RING_DASH_LENGTH_M + LOITER_RING_GAP_LENGTH_M
    const dashCount = Math.min(FLOATING_PATH_MAX_DASHES_PER_LEG, Math.max(1, Math.floor(circumferenceM / periodM)))

    for (let d = 0; d < dashCount; d++) {
      const startM = d * periodM
      const endM = Math.min(circumferenceM, startM + LOITER_RING_DASH_LENGTH_M)
      const angle0 = (startM / circumferenceM) * 360
      const angle1 = (endM / circumferenceM) * 360

      const p0 = pointOnCircle(center, angle0, item.radiusM)
      const p1 = pointOnCircle(center, angle1, item.radiusM)

      const dLon = p1.lon - p0.lon
      const dLat = p1.lat - p0.lat
      const len = Math.hypot(dLon, dLat) || 1
      const { dLat: halfWidthLat, dLon: halfWidthLon } = metersToDegreesAt((p0.lat + p1.lat) / 2, LOITER_RING_HALF_WIDTH_M)
      const perpLon = (-dLat / len) * halfWidthLon
      const perpLat = (dLon / len) * halfWidthLat

      const ring: [number, number][] = [
        [p0.lon - perpLon, p0.lat - perpLat],
        [p1.lon - perpLon, p1.lat - perpLat],
        [p1.lon + perpLon, p1.lat + perpLat],
        [p0.lon + perpLon, p0.lat + perpLat],
        [p0.lon - perpLon, p0.lat - perpLat],
      ]

      features.push({
        type: 'Feature',
        properties: {
          base: Math.max(0, item.altM - LOITER_RING_HALF_THICKNESS_M),
          top: item.altM + LOITER_RING_HALF_THICKNESS_M,
        },
        geometry: { type: 'Polygon', coordinates: [ring] },
      })
    }
  }

  return { type: 'FeatureCollection', features }
}

export interface AircraftPose {
  point: GeoPoint
  altM: number
  headingDeg: number
}

const AIRCRAFT_MARKER_NOSE_M = 5
const AIRCRAFT_MARKER_TAIL_M = 3
const AIRCRAFT_MARKER_HALF_WIDTH_M = 3
const AIRCRAFT_MARKER_HALF_THICKNESS_M = 1

function rotateLocalMeters(eastM: number, northM: number, headingDeg: number): { eastM: number; northM: number } {
  const rad = (headingDeg * Math.PI) / 180
  const sin = Math.sin(rad)
  const cos = Math.cos(rad)
  // Clockwise rotation (matching bearingDeg's compass convention: 0=N, 90=E).
  return { eastM: eastM * cos + northM * sin, northM: -eastM * sin + northM * cos }
}

/** The aircraft indicator, floating at the vehicle's actual altitude and
 * pointed in its actual heading — same fill-extrusion trick as the mission
 * markers/path, since neither MapLibre's DOM `Marker` nor its line layers
 * support altitude. A small triangle (nose forward) built in local
 * east/north metres around the vehicle's position, rotated by headingDeg,
 * then converted to lon/lat offsets. */
export function buildAircraftMarkerGeoJson(pose: AircraftPose | null): FeatureCollection<Polygon> {
  if (!pose) return { type: 'FeatureCollection', features: [] }
  const { point, altM, headingDeg } = pose

  const { dLat: dLatPerM, dLon: dLonPerM } = metersToDegreesAt(point.lat, 1)

  function toLngLat(eastM: number, northM: number): [number, number] {
    const rotated = rotateLocalMeters(eastM, northM, headingDeg)
    return [point.lon + rotated.eastM * dLonPerM, point.lat + rotated.northM * dLatPerM]
  }

  const nose = toLngLat(0, AIRCRAFT_MARKER_NOSE_M)
  const tailRight = toLngLat(AIRCRAFT_MARKER_HALF_WIDTH_M, -AIRCRAFT_MARKER_TAIL_M)
  const tailLeft = toLngLat(-AIRCRAFT_MARKER_HALF_WIDTH_M, -AIRCRAFT_MARKER_TAIL_M)
  const ring: [number, number][] = [nose, tailRight, tailLeft, nose]

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          base: Math.max(0, altM - AIRCRAFT_MARKER_HALF_THICKNESS_M),
          top: altM + AIRCRAFT_MARKER_HALF_THICKNESS_M,
        },
        geometry: { type: 'Polygon', coordinates: [ring] },
      },
    ],
  }
}

export function buildFenceGeoJson(mission: Mission | null): Feature<Polygon> | null {
  const polygon = mission?.fence?.polygon
  if (!polygon || polygon.length < 3) return null

  const ring = polygon.map((p) => [p.lon, p.lat] as [number, number])
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push(first)

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
}
