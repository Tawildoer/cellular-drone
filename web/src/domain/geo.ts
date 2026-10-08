import type { GeoPoint } from './mission'

const EARTH_RADIUS_M = 6_371_000

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Great-circle distance between two points, in metres. */
export function haversineDistanceM(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const sinDLat = Math.sin(dLat / 2)
  const sinDLon = Math.sin(dLon / 2)
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Point-in-polygon via ray casting. The polygon need not be explicitly closed
 * (first point repeated as last) — this treats it as closed implicitly.
 */
export function isPointInPolygon(point: GeoPoint, polygon: GeoPoint[]): boolean {
  if (polygon.length < 3) return false

  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (!a || !b) continue

    const intersects =
      a.lat !== b.lat &&
      point.lat >= Math.min(a.lat, b.lat) &&
      point.lat < Math.max(a.lat, b.lat) &&
      point.lon < ((b.lon - a.lon) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lon

    if (intersects) inside = !inside
  }
  return inside
}

/** Initial compass bearing from `a` to `b`, in degrees [0, 360). */
export function bearingDeg(a: GeoPoint, b: GeoPoint): number {
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const dLon = toRad(b.lon - a.lon)

  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  const deg = (Math.atan2(y, x) * 180) / Math.PI

  return (deg + 360) % 360
}

/**
 * Steps a point `distanceM` towards `target`, clamped so it never overshoots.
 * Linear interpolation in lat/lon — fine at the short ranges a sim covers.
 */
export function moveToward(point: GeoPoint, target: GeoPoint, distanceM: number): { point: GeoPoint; arrived: boolean } {
  const remainingM = haversineDistanceM(point, target)
  if (remainingM <= distanceM || remainingM === 0) {
    return { point: { lat: target.lat, lon: target.lon }, arrived: true }
  }

  const fraction = distanceM / remainingM
  return {
    point: {
      lat: point.lat + (target.lat - point.lat) * fraction,
      lon: point.lon + (target.lon - point.lon) * fraction,
    },
    arrived: false,
  }
}

/** Total path length through an ordered list of points, in metres. */
export function pathLengthM(points: GeoPoint[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    if (!prev || !curr) continue
    total += haversineDistanceM(prev, curr)
  }
  return total
}

const METERS_PER_DEG_LAT = 111_320

function localEastNorthM(origin: GeoPoint, p: GeoPoint): { eastM: number; northM: number } {
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos(toRad(origin.lat))
  return { eastM: (p.lon - origin.lon) * metersPerDegLon, northM: (p.lat - origin.lat) * METERS_PER_DEG_LAT }
}

/** Inverse of `localEastNorthM` — a point `eastM`/`northM` metres from `origin`. */
export function fromLocalEastNorthM(origin: GeoPoint, eastM: number, northM: number): GeoPoint {
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos(toRad(origin.lat))
  return { lat: origin.lat + northM / METERS_PER_DEG_LAT, lon: origin.lon + eastM / metersPerDegLon }
}

export interface SegmentProjection {
  segLen: number
  dirEast: number
  dirNorth: number
  /** Distance (metres) along the segment, from `from`, of the point closest to `position` — clamped to [0, segLen]. */
  closestDistAlong: number
  /** Perpendicular distance (metres) from `position` to the segment. */
  crossTrackM: number
}

/** The foot-of-perpendicular projection of `position` onto the `from -> to`
 * segment, in local east/north metres — shared by anything that needs to
 * know "where along this line is the aircraft" (L1 guidance's look-ahead
 * point, trimming an already-flown path). Null for a degenerate
 * (near-zero-length) segment. */
export function projectOntoSegment(position: GeoPoint, from: GeoPoint, to: GeoPoint): SegmentProjection | null {
  const end = localEastNorthM(from, to)
  const segLenSq = end.eastM * end.eastM + end.northM * end.northM
  if (segLenSq < 1) return null

  const segLen = Math.sqrt(segLenSq)
  const dirEast = end.eastM / segLen
  const dirNorth = end.northM / segLen

  const p = localEastNorthM(from, position)
  const closestDistAlong = Math.max(0, Math.min(segLen, p.eastM * dirEast + p.northM * dirNorth))
  const crossEastM = p.eastM - dirEast * closestDistAlong
  const crossNorthM = p.northM - dirNorth * closestDistAlong
  const crossTrackM = Math.hypot(crossEastM, crossNorthM)

  return { segLen, dirEast, dirNorth, closestDistAlong, crossTrackM }
}

/**
 * Fraction (0..1) along the `from -> to` segment of the point closest to
 * `position` — i.e. how far "behind" the aircraft a point on the line is,
 * measured perpendicular to the segment rather than by distance to the
 * aircraft itself. Used to erase an already-flown planned-path segment
 * progressively as the aircraft passes it, rather than all at once. A
 * degenerate (near-zero-length) segment reads as fully behind (1).
 */
export function alongTrackFraction(position: GeoPoint, from: GeoPoint, to: GeoPoint): number {
  const proj = projectOntoSegment(position, from, to)
  return proj ? proj.closestDistAlong / proj.segLen : 1
}

/**
 * Whether segments `a1 -> a2` and `b1 -> b2` cross or touch, in local
 * east/north metres. Touching counts: a leg that grazes a fence line is
 * treated as crossing it.
 */
export function segmentsIntersect(a1: GeoPoint, a2: GeoPoint, b1: GeoPoint, b2: GeoPoint): boolean {
  const origin = a1
  const p = [a1, a2, b1, b2].map((point) => localEastNorthM(origin, point))
  const [pa1, pa2, pb1, pb2] = p as [Local, Local, Local, Local]

  const d1 = cross(pb1, pb2, pa1)
  const d2 = cross(pb1, pb2, pa2)
  const d3 = cross(pa1, pa2, pb1)
  const d4 = cross(pa1, pa2, pb2)

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  return (
    (d1 === 0 && onSegment(pb1, pb2, pa1)) ||
    (d2 === 0 && onSegment(pb1, pb2, pa2)) ||
    (d3 === 0 && onSegment(pa1, pa2, pb1)) ||
    (d4 === 0 && onSegment(pa1, pa2, pb2))
  )
}

type Local = { eastM: number; northM: number }

/** z of (b - a) × (c - a): which side of line a→b point c is on. */
function cross(a: Local, b: Local, c: Local): number {
  return (b.eastM - a.eastM) * (c.northM - a.northM) - (b.northM - a.northM) * (c.eastM - a.eastM)
}

/** For c already collinear with a→b: whether it lies within the segment. */
function onSegment(a: Local, b: Local, c: Local): boolean {
  return (
    Math.min(a.eastM, b.eastM) <= c.eastM &&
    c.eastM <= Math.max(a.eastM, b.eastM) &&
    Math.min(a.northM, b.northM) <= c.northM &&
    c.northM <= Math.max(a.northM, b.northM)
  )
}

/** Shortest distance, in metres, from `point` to the polygon's boundary. */
export function distanceToPolygonEdgeM(point: GeoPoint, polygon: GeoPoint[]): number {
  let best = Infinity
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]
    const b = polygon[i]
    if (!a || !b) continue
    const proj = projectOntoSegment(point, a, b)
    best = Math.min(best, proj ? proj.crossTrackM : haversineDistanceM(point, a))
  }
  return best
}
