import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson'
import {
  alongTrackFraction,
  bearingDeg,
  fromLocalEastNorthM,
  haversineDistanceM,
  itemPosition,
  legWindTint,
  type CellularSignal,
  type GimbalAttitude,
  type GeoPoint,
  type Mission,
  type WindVector,
} from '../../domain'

/** A safety cap; the trail is normally limited by age (TRAIL_LIFETIME_MS). */
export const MAX_TRAIL_POINTS = 1000

/** How long a piece of trail lasts: fully visible, then fading out over
 * TRAIL_FADE_MS, gone at TRAIL_LIFETIME_MS. */
export const TRAIL_LIFETIME_MS = 60_000
export const TRAIL_FADE_MS = 20_000

export interface AltitudePoint {
  point: GeoPoint
  altM: number
  /** When it was recorded (epoch ms): trail points fade out by age. */
  atMs?: number
  /** What the drone measured there, for colouring the trail. */
  conditions?: TrailConditions
}

export interface TrailConditions {
  groundSpeedMps: number
  /** Measured by the aircraft, else the forecast. */
  wind?: WindVector
  cellular?: CellularSignal
}

/** A trail segment's value for the path colour (pathColoring.ts), or
 * undefined where there's nothing to colour it by. */
export type TrailValue = (a: AltitudePoint, b: AltitudePoint) => number | undefined
/** The same for a stretch of planned route, at its middle. */
export type RouteValue = (at: GeoPoint, altM: number, trackDeg: number) => number | undefined

/** Adds a point; with `nowMs`, also drops points older than the lifetime. */
export function appendTrailPoint(trail: AltitudePoint[], point: AltitudePoint, max = MAX_TRAIL_POINTS, nowMs?: number): AltitudePoint[] {
  let next = [...trail, point]
  if (nowMs !== undefined) next = next.filter((p) => p.atMs === undefined || nowMs - p.atMs < TRAIL_LIFETIME_MS)
  return next.length > max ? next.slice(next.length - max) : next
}

/** 1 while a trail point is young, easing to 0 as it expires; 1 without times. */
export function trailFade(atMs: number | undefined, nowMs: number | undefined): number {
  if (atMs === undefined || nowMs === undefined) return 1
  const left = TRAIL_LIFETIME_MS - (nowMs - atMs)
  return Math.min(1, Math.max(0, left / TRAIL_FADE_MS))
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

/** MapLibre's world width in pixels at zoom 0 (512px tiles). */
const WORLD_PX_AT_ZOOM_0 = 512
const EARTH_CIRCUMFERENCE_M = 40_075_016.686

/** Ground metres covered by one screen pixel at this zoom and latitude. */
export function metersPerPixel(zoom: number, lat: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (WORLD_PX_AT_ZOOM_0 * 2 ** zoom)
}

/** Every overlay below is built in real metres, which shrink to nothing as
 * the map zooms out (a 1.2m-wide path is sub-pixel by ~15m/px and simply
 * vanishes). Builders take the view's metres-per-pixel and enlarge each
 * footprint dimension to at least `minPx` on screen; 0 means true scale.
 * Altitudes are never scaled. */
function atLeastPx(trueM: number, minPx: number, metersPerPx: number): number {
  return Math.max(trueM, minPx * metersPerPx)
}

/** On-screen minimums for the ribbon overlays (path, loiter ring, trail). */
const LINE_MIN_HALF_WIDTH_PX = 1.5
const DASH_MIN_PX = 8
const DASH_GAP_MIN_PX = 6

const TRAIL_HALF_WIDTH_M = 0.8
const TRAIL_HALF_THICKNESS_M = 0.8

/** The trail's oldest end is drawn this fraction of full width, tapering
 * up to full width at the aircraft. */
const TRAIL_TAIL_WIDTH = 0.1

/** The drone's actual flown path, floating at its real recorded altitude
 * instead of flat on the ground — same `fill-extrusion` ribbon technique as
 * the planned path, but solid (not dashed, to read as "where it's been"
 * rather than "where it's going") and built straight from the recorded
 * trail points rather than interpolated along a prescribed line, since
 * telemetry is already sampled every tick.
 *
 * Pieces of trail fade out as they expire (trailFade, by age, given
 * `nowMs`): each segment carries `fade` (1 fresh, 0 expiring), which the
 * layer maps to colour, and it narrows as it fades. (A fill-extrusion
 * layer's opacity can't vary per feature, so the fade is colour and width.) */
export function buildFloatingTrailGeoJson(
  trail: AltitudePoint[],
  metersPerPx = 0,
  nowMs?: number,
  valueOf?: TrailValue,
): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = []
  const halfWidthM = atLeastPx(TRAIL_HALF_WIDTH_M, LINE_MIN_HALF_WIDTH_PX, metersPerPx)

  const segments = trail.length - 1
  for (let i = 0; i < segments; i++) {
    const a = trail[i]
    const b = trail[i + 1]
    if (!a || !b) continue

    const dLon = b.point.lon - a.point.lon
    const dLat = b.point.lat - a.point.lat
    const len = Math.hypot(dLon, dLat)
    if (len === 0) continue

    const fade = trailFade(a.atMs, nowMs)
    if (fade <= 0) continue
    const width = halfWidthM * (TRAIL_TAIL_WIDTH + (1 - TRAIL_TAIL_WIDTH) * fade)
    const { dLat: halfWidthLat, dLon: halfWidthLon } = metersToDegreesAt((a.point.lat + b.point.lat) / 2, width)
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
    const v = valueOf?.(a, b)
    features.push({
      type: 'Feature',
      properties: {
        base: Math.max(0, altMid - TRAIL_HALF_THICKNESS_M),
        top: altMid + TRAIL_HALF_THICKNESS_M,
        fade,
        ...(v === undefined ? {} : { v }),
      },
      geometry: { type: 'Polygon', coordinates: [ring] },
    })
  }

  return { type: 'FeatureCollection', features }
}

const WAYPOINT_MARKER_HALF_WIDTH_M = 2
const WAYPOINT_MARKER_HALF_THICKNESS_M = 1.5
/** Waypoint blocks never draw smaller than 12px square. */
const WAYPOINT_MARKER_MIN_HALF_WIDTH_PX = 6

/** A waypoint the vehicle has flown through: it stays on the map, marked
 * done (green), while the legs up to it are dropped. */
function isDone(itemIndex: number, clearedBeforeIndex: number | undefined): boolean {
  return clearedBeforeIndex !== undefined && itemIndex < clearedBeforeIndex
}

/** MapLibre's line/marker primitives have no altitude, so each waypoint/
 * loiter item gets a small `fill-extrusion` block hovering at its altM — a
 * thin slab (base/top bracket altM), not a column down to the ground, so it
 * reads as a marker floating in place rather than a post. Same mechanism as
 * the 3D buildings; only visible once the camera is tilted off straight-down.
 *
 * `clearedBeforeIndex`, when given, marks markers before that mission.items
 * index `done`: a waypoint the vehicle has flown through stays, drawn green,
 * while the legs up to it are dropped (buildMissionFloatingPathGeoJson). */
export function buildMissionWaypointMarkersGeoJson(
  mission: Mission | null,
  clearedBeforeIndex?: number,
  metersPerPx = 0,
): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = []
  const halfWidthM = atLeastPx(WAYPOINT_MARKER_HALF_WIDTH_M, WAYPOINT_MARKER_MIN_HALF_WIDTH_PX, metersPerPx)

  for (const [itemIndex, item] of (mission?.items ?? []).entries()) {
    if (item.type !== 'waypoint' && item.type !== 'loiter') continue

    const { dLat, dLon } = metersToDegreesAt(item.lat, halfWidthM)
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
        done: isDone(itemIndex, clearedBeforeIndex),
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
 * vanishing all at once only once the waypoint is finally reached.
 *
 * `wind`, when given, tags each dash with its leg's `windTint` (headwind or
 * tailwind, ADR-0026) for the path's colour. */
export function buildMissionFloatingPathGeoJson(
  mission: Mission | null,
  fromPoint?: AltitudePoint,
  clearedBeforeIndex?: number,
  dronePosition?: GeoPoint,
  metersPerPx = 0,
  wind?: WindVector | null,
  valueOf?: RouteValue,
): FeatureCollection<Polygon> {
  const missionPoints = missionAltitudePoints(mission)
  const altPoints: IndexedAltitudePoint[] =
    fromPoint && missionPoints.length > 0 ? [{ ...fromPoint, itemIndex: -1 }, ...missionPoints] : missionPoints
  const features: Feature<Polygon>[] = []
  const dashM = atLeastPx(FLOATING_PATH_DASH_LENGTH_M, DASH_MIN_PX, metersPerPx)
  const periodM = dashM + atLeastPx(FLOATING_PATH_GAP_LENGTH_M, DASH_GAP_MIN_PX, metersPerPx)
  const halfWidthM = atLeastPx(FLOATING_PATH_HALF_WIDTH_M, LINE_MIN_HALF_WIDTH_PX, metersPerPx)

  for (let i = 0; i < altPoints.length - 1; i++) {
    const a = altPoints[i]
    const b = altPoints[i + 1]
    if (!a || !b) continue
    if (clearedBeforeIndex !== undefined && b.itemIndex < clearedBeforeIndex) continue

    const legLengthM = haversineDistanceM(a.point, b.point)
    if (legLengthM === 0) continue

    const isCurrentLeg = dronePosition !== undefined && b.itemIndex === clearedBeforeIndex
    const behindFraction = isCurrentLeg && dronePosition ? alongTrackFraction(dronePosition, a.point, b.point) : 0

    const dashCount = Math.min(FLOATING_PATH_MAX_DASHES_PER_LEG, Math.max(1, Math.floor(legLengthM / periodM)))
    const trackDeg = bearingDeg(a.point, b.point)
    const windTint = legWindTint(trackDeg, wind)

    for (let d = 0; d < dashCount; d++) {
      const startM = d * periodM
      const endM = Math.min(legLengthM, startM + dashM)
      const t0 = startM / legLengthM
      const t1 = endM / legLengthM
      if (t1 <= behindFraction) continue

      const lon0 = lerp(a.point.lon, b.point.lon, t0)
      const lat0 = lerp(a.point.lat, b.point.lat, t0)
      const lon1 = lerp(a.point.lon, b.point.lon, t1)
      const lat1 = lerp(a.point.lat, b.point.lat, t1)
      const altMid = lerp(a.altM, b.altM, (t0 + t1) / 2)
      const v = valueOf?.({ lat: lerp(lat0, lat1, 0.5), lon: lerp(lon0, lon1, 0.5) }, altMid, trackDeg)

      const dLon = lon1 - lon0
      const dLat = lat1 - lat0
      const len = Math.hypot(dLon, dLat) || 1
      const { dLat: halfWidthLat, dLon: halfWidthLon } = metersToDegreesAt((lat0 + lat1) / 2, halfWidthM)
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
          windTint,
          ...(v === undefined ? {} : { v }),
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
export function buildMissionLoiterRingsGeoJson(
  mission: Mission | null,
  clearedBeforeIndex?: number,
  metersPerPx = 0,
): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = []
  const dashM = atLeastPx(LOITER_RING_DASH_LENGTH_M, DASH_MIN_PX, metersPerPx)
  const periodM = dashM + atLeastPx(LOITER_RING_GAP_LENGTH_M, DASH_GAP_MIN_PX, metersPerPx)
  const halfWidthM = atLeastPx(LOITER_RING_HALF_WIDTH_M, LINE_MIN_HALF_WIDTH_PX, metersPerPx)

  for (const [itemIndex, item] of (mission?.items ?? []).entries()) {
    if (item.type !== 'loiter') continue
    if (clearedBeforeIndex !== undefined && itemIndex < clearedBeforeIndex) continue

    const center: GeoPoint = { lat: item.lat, lon: item.lon }
    const circumferenceM = 2 * Math.PI * item.radiusM
    if (circumferenceM === 0) continue

    const dashCount = Math.min(FLOATING_PATH_MAX_DASHES_PER_LEG, Math.max(1, Math.floor(circumferenceM / periodM)))

    for (let d = 0; d < dashCount; d++) {
      const startM = d * periodM
      const endM = Math.min(circumferenceM, startM + dashM)
      const angle0 = (startM / circumferenceM) * 360
      const angle1 = (endM / circumferenceM) * 360

      const p0 = pointOnCircle(center, angle0, item.radiusM)
      const p1 = pointOnCircle(center, angle1, item.radiusM)

      const dLon = p1.lon - p0.lon
      const dLat = p1.lat - p0.lat
      const len = Math.hypot(dLon, dLat) || 1
      const { dLat: halfWidthLat, dLon: halfWidthLon } = metersToDegreesAt((p0.lat + p1.lat) / 2, halfWidthM)
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

// --- Flat (zoomed-out) overlays ---------------------------------------
//
// The 3D overlays above all sit in the drone's own ~1m altitude band (it flies
// exactly along its route), so from far away the depth buffer can't separate
// them and they z-fight through each other. Zoomed out, FlightMap swaps them
// for these: plain lines and points with no altitude, which MapLibre draws at
// a fixed pixel size in layer order — nothing to fight. Same clearing rules
// as the 3D versions.

function featureCollection<G extends LineString | Point>(features: Feature<G>[]): FeatureCollection<G> {
  return { type: 'FeatureCollection', features }
}

function lngLat(point: GeoPoint): [number, number] {
  return [point.lon, point.lat]
}

/** The flat trail. With `nowMs`, segments that are expiring come out one by
 * one with their `fade` (for line-opacity); the fresh part stays one line.
 * With `valueOf`, every segment comes out alone, carrying its value `v`. */
export function buildTrailLineGeoJson(trail: AltitudePoint[], nowMs?: number, valueOf?: TrailValue): FeatureCollection<LineString> {
  if (trail.length < 2) return featureCollection<LineString>([])
  const features: Feature<LineString>[] = []
  if (valueOf) {
    for (let i = 0; i < trail.length - 1; i++) {
      const a = trail[i]!
      const b = trail[i + 1]!
      const v = valueOf(a, b)
      features.push({
        type: 'Feature',
        properties: { fade: trailFade(a.atMs, nowMs), ...(v === undefined ? {} : { v }) },
        geometry: { type: 'LineString', coordinates: [lngLat(a.point), lngLat(b.point)] },
      })
    }
    return featureCollection(features)
  }
  const fresh: [number, number][] = []
  for (let i = 0; i < trail.length - 1; i++) {
    const a = trail[i]!
    const b = trail[i + 1]!
    const fade = trailFade(a.atMs, nowMs)
    if (fade >= 1) {
      if (fresh.length === 0) fresh.push(lngLat(a.point))
      fresh.push(lngLat(b.point))
    } else if (fade > 0) {
      features.push({ type: 'Feature', properties: { fade }, geometry: { type: 'LineString', coordinates: [lngLat(a.point), lngLat(b.point)] } })
    }
  }
  if (fresh.length > 1) features.push({ type: 'Feature', properties: { fade: 1 }, geometry: { type: 'LineString', coordinates: fresh } })
  return featureCollection(features)
}

export function buildMissionWaypointPointsGeoJson(mission: Mission | null, clearedBeforeIndex?: number): FeatureCollection<Point> {
  const features: Feature<Point>[] = []
  for (const [itemIndex, item] of (mission?.items ?? []).entries()) {
    if (item.type !== 'waypoint' && item.type !== 'loiter') continue
    features.push({
      type: 'Feature',
      properties: { done: isDone(itemIndex, clearedBeforeIndex) },
      geometry: { type: 'Point', coordinates: lngLat(item) },
    })
  }
  return featureCollection(features)
}

/** A coloured flat route is cut into pieces about this long. */
const ROUTE_LINE_PIECE_M = 50
const ROUTE_LINE_MAX_PIECES = 200

/** One line per leg, same arguments as buildMissionFloatingPathGeoJson; the
 * current leg starts at the drone's along-track projection rather than
 * dropping dashes behind it. */
export function buildMissionPathLinesGeoJson(
  mission: Mission | null,
  fromPoint?: AltitudePoint,
  clearedBeforeIndex?: number,
  dronePosition?: GeoPoint,
  wind?: WindVector | null,
  valueOf?: RouteValue,
): FeatureCollection<LineString> {
  const missionPoints = missionAltitudePoints(mission)
  const points: IndexedAltitudePoint[] =
    fromPoint && missionPoints.length > 0 ? [{ ...fromPoint, itemIndex: -1 }, ...missionPoints] : missionPoints
  const features: Feature<LineString>[] = []

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (!a || !b) continue
    if (clearedBeforeIndex !== undefined && b.itemIndex < clearedBeforeIndex) continue

    const isCurrentLeg = dronePosition !== undefined && b.itemIndex === clearedBeforeIndex
    const behind = isCurrentLeg && dronePosition ? Math.max(0, alongTrackFraction(dronePosition, a.point, b.point)) : 0
    if (behind >= 1) continue
    const start: GeoPoint = { lat: lerp(a.point.lat, b.point.lat, behind), lon: lerp(a.point.lon, b.point.lon, behind) }
    const trackDeg = bearingDeg(a.point, b.point)
    const windTint = legWindTint(trackDeg, wind)
    if (!valueOf) {
      features.push({
        type: 'Feature',
        properties: { windTint },
        geometry: { type: 'LineString', coordinates: [lngLat(start), lngLat(b.point)] },
      })
      continue
    }
    // Coloured by a value that changes along the leg: in short pieces.
    const pieces = Math.min(ROUTE_LINE_MAX_PIECES, Math.max(1, Math.ceil(((1 - behind) * haversineDistanceM(a.point, b.point)) / ROUTE_LINE_PIECE_M)))
    for (let k = 0; k < pieces; k++) {
      const t0 = behind + ((1 - behind) * k) / pieces
      const t1 = behind + ((1 - behind) * (k + 1)) / pieces
      const at = (t: number): GeoPoint => ({ lat: lerp(a.point.lat, b.point.lat, t), lon: lerp(a.point.lon, b.point.lon, t) })
      const v = valueOf(at((t0 + t1) / 2), lerp(a.altM, b.altM, (t0 + t1) / 2), trackDeg)
      features.push({
        type: 'Feature',
        properties: { windTint, ...(v === undefined ? {} : { v }) },
        geometry: { type: 'LineString', coordinates: [lngLat(at(t0)), lngLat(at(t1))] },
      })
    }
  }
  return featureCollection(features)
}

const LOITER_RING_LINE_SEGMENTS = 64

export function buildMissionLoiterRingLinesGeoJson(mission: Mission | null, clearedBeforeIndex?: number): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = []
  for (const [itemIndex, item] of (mission?.items ?? []).entries()) {
    if (item.type !== 'loiter') continue
    if (clearedBeforeIndex !== undefined && itemIndex < clearedBeforeIndex) continue
    const center: GeoPoint = { lat: item.lat, lon: item.lon }
    const coordinates = Array.from({ length: LOITER_RING_LINE_SEGMENTS + 1 }, (_, i) =>
      lngLat(pointOnCircle(center, (i / LOITER_RING_LINE_SEGMENTS) * 360, item.radiusM)),
    )
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })
  }
  return featureCollection(features)
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
/** Nose-to-tail at true scale. */
const AIRCRAFT_MARKER_LENGTH_M = AIRCRAFT_MARKER_NOSE_M + AIRCRAFT_MARKER_TAIL_M
/** The marker never draws smaller than this on screen. At true scale it was
 * ~9px at the flight screen's opening zoom, too small to pick out from the
 * end of its own trail. */
export const AIRCRAFT_MARKER_MIN_PX = 28

/** How much to enlarge the aircraft marker so it's at least
 * AIRCRAFT_MARKER_MIN_PX long at this zoom and latitude. 1 (true scale) once
 * zoomed in far enough that the real size already exceeds that. */
export function aircraftMarkerScale(zoom: number, lat: number): number {
  return atLeastPx(AIRCRAFT_MARKER_LENGTH_M, AIRCRAFT_MARKER_MIN_PX, metersPerPixel(zoom, lat)) / AIRCRAFT_MARKER_LENGTH_M
}

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
 * then converted to lon/lat offsets. `scale` enlarges the footprint (not the
 * altitude) so it stays legible when zoomed out — see aircraftMarkerScale. */
export function buildAircraftMarkerGeoJson(pose: AircraftPose | null, scale = 1): FeatureCollection<Polygon> {
  if (!pose) return { type: 'FeatureCollection', features: [] }
  const { point, altM, headingDeg } = pose

  const { dLat: dLatPerM, dLon: dLonPerM } = metersToDegreesAt(point.lat, 1)

  function toLngLat(eastM: number, northM: number): [number, number] {
    const rotated = rotateLocalMeters(eastM * scale, northM * scale, headingDeg)
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

/** Ground reach beyond which a near-level gimbal's ray stops short instead
 * of running to a far horizon. */
const GIMBAL_RAY_MAX_REACH_M = 2000
/** Ray marching: steps along the ground, then halving to pin the hit. */
const GIMBAL_RAY_MIN_STEP_M = 1
const GIMBAL_RAY_MAX_STEP_M = 20
const GIMBAL_RAY_REFINE_STEPS = 10
/** Steeper than this is straight down: no marching needed. */
const GIMBAL_RAY_VERTICAL_DIP_DEG = 89.9

export interface GimbalRay {
  /** Where the ray ends: on the ground at the gimbal's focus, or short of it. */
  end: GeoPoint
  /** Heights in the ground model's frame (above sea level with terrain). */
  startHeightM: number
  endHeightM: number
  /** Whether it reached the ground (false: cut off at max reach). */
  hitsGround: boolean
}

/**
 * Where the gimbal is looking: the ray from the aircraft along its heading
 * plus the gimbal's yaw, dipping at the gimbal's pitch, to where it first
 * meets the ground. `groundAt` gives the ground's height at a point (the
 * map's terrain); without it the ground is flat at 0. The aircraft sits
 * `pose.altM` above the ground under it, as the map draws it. Pointed at a
 * spot (a lock, ADR-0023, or a loiter's centre), the ray ends on that spot:
 * it's where the vehicle says the camera is looking, and the line shouldn't drift off it as the aircraft's
 * drawn height and the terrain disagree slightly. Null on the ground, with
 * no gimbal, or looking level or up.
 */
export function gimbalRay(
  pose: AircraftPose | null,
  gimbal: GimbalAttitude | undefined,
  groundAt: (point: GeoPoint) => number = () => 0,
): GimbalRay | null {
  if (!pose || !gimbal || pose.altM <= 0.5) return null
  const startHeightM = groundAt(pose.point) + pose.altM
  const spot = gimbal.lookAt ?? gimbal.lock
  if (spot) {
    const end = { lat: spot.lat, lon: spot.lon }
    return { end, startHeightM, endHeightM: groundAt(end), hitsGround: true }
  }
  const dipDeg = Math.min(90, -gimbal.pitchDeg)
  if (dipDeg <= 0.5) return null
  if (dipDeg >= GIMBAL_RAY_VERTICAL_DIP_DEG) {
    return { end: pose.point, startHeightM, endHeightM: groundAt(pose.point), hitsGround: true }
  }

  const rad = ((pose.headingDeg + gimbal.yawDeg) * Math.PI) / 180
  const pointAt = (reachM: number) => fromLocalEastNorthM(pose.point, Math.sin(rad) * reachM, Math.cos(rad) * reachM)
  const tanDip = Math.tan((dipDeg * Math.PI) / 180)
  const heightAt = (reachM: number) => startHeightM - reachM * tanDip
  const above = (reachM: number) => heightAt(reachM) - groundAt(pointAt(reachM))

  // Step out until the ray is at or below the ground, then halve the last
  // step. The step scales with where flat ground would be hit.
  const step = Math.min(GIMBAL_RAY_MAX_STEP_M, Math.max(GIMBAL_RAY_MIN_STEP_M, pose.altM / tanDip / 40))
  let near = 0
  let far = -1
  for (let s = step; s <= GIMBAL_RAY_MAX_REACH_M + step / 2; s += step) {
    const reach = Math.min(s, GIMBAL_RAY_MAX_REACH_M)
    if (above(reach) <= 0) {
      far = reach
      break
    }
    near = reach
  }
  if (far < 0) {
    const end = pointAt(GIMBAL_RAY_MAX_REACH_M)
    return { end, startHeightM, endHeightM: heightAt(GIMBAL_RAY_MAX_REACH_M), hitsGround: false }
  }
  for (let i = 0; i < GIMBAL_RAY_REFINE_STEPS; i++) {
    const mid = (near + far) / 2
    if (above(mid) <= 0) far = mid
    else near = mid
  }
  const end = pointAt(far)
  return { end, startHeightM, endHeightM: groundAt(end), hitsGround: true }
}

/** The spot the gimbal is locked onto, if any (ADR-0023). */
export function buildGimbalLockGeoJson(gimbal: GimbalAttitude | undefined): FeatureCollection<Point> {
  const lock = gimbal?.lock
  if (!lock) return featureCollection([])
  return featureCollection([{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lock.lon, lock.lat] } }])
}

/** The zoomed-out stand-in: a flat line from the aircraft to the focus. */
export function buildGimbalRayLineGeoJson(pose: AircraftPose | null, ray: GimbalRay | null): FeatureCollection<LineString> {
  if (!pose || !ray) return featureCollection([])
  return featureCollection([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [lngLat(pose.point), lngLat(ray.end)] } }])
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

/** Never zoom closer than this when fitting the mission: a tiny mission
 * would otherwise fill the screen with a few metres of ground. */
export const MISSION_FIT_MAX_ZOOM = 17

/** [[west, south], [east, north]], MapLibre's LngLatBounds order. */
export type LngLatBoundsLike = [[number, number], [number, number]]

/**
 * The box around everything the operator needs in view: every item with a
 * position (to the outer edge of each loiter circle), home and the drone.
 * From `fromIndex`, only the items still to fly: home then counts only if
 * one of them goes there (a takeoff or return to launch). Null when there's
 * nothing to show.
 */
export function missionBounds(
  mission: Mission | null,
  home: GeoPoint | null,
  drone: GeoPoint | null,
  fromIndex = 0,
): LngLatBoundsLike | null {
  const items = mission?.items.slice(fromIndex) ?? []
  const visitsHome = fromIndex === 0 || items.some((item) => item.type === 'returnToLaunch' || item.type === 'vtolTakeoff')
  const points: GeoPoint[] = []
  for (const item of items) {
    const point = itemPosition(item)
    if (!point) continue
    if (item.type === 'loiter') {
      const { dLat, dLon } = metersToDegreesAt(point.lat, item.radiusM)
      points.push({ lat: point.lat - dLat, lon: point.lon - dLon }, { lat: point.lat + dLat, lon: point.lon + dLon })
    } else {
      points.push(point)
    }
  }
  if (home && visitsHome) points.push(home)
  if (drone) points.push(drone)
  if (points.length === 0) return null
  const lons = points.map((p) => p.lon)
  const lats = points.map((p) => p.lat)
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ]
}

/** An aircraft pose with when this browser received it (performance.now()). */
export interface TimedPose extends AircraftPose {
  atMs: number
}

/** Telemetry gaps outside this are clamped: a burst or a stall shouldn't make
 * the motion race or freeze for long. */
const POSE_GAP_MIN_MS = 40
const POSE_GAP_MAX_MS = 1000

/**
 * Where to draw the aircraft between telemetry updates: part-way from the
 * previous pose to the latest, by how much of the last update gap has passed
 * since the latest arrived. That's one update (~100 ms) behind, and
 * continuous: no stepping 10 times a second. Holds at the latest pose once
 * the gap has passed rather than guessing ahead.
 */
export function interpolatePose(prev: TimedPose | null, latest: TimedPose, nowMs: number): AircraftPose {
  if (!prev) return latest
  const gap = Math.min(POSE_GAP_MAX_MS, Math.max(POSE_GAP_MIN_MS, latest.atMs - prev.atMs))
  const f = Math.min(1, Math.max(0, (nowMs - latest.atMs) / gap))
  const turn = ((latest.headingDeg - prev.headingDeg + 540) % 360) - 180
  return {
    point: { lat: lerp(prev.point.lat, latest.point.lat, f), lon: lerp(prev.point.lon, latest.point.lon, f) },
    altM: lerp(prev.altM, latest.altM, f),
    headingDeg: (prev.headingDeg + turn * f + 360) % 360,
  }
}

/**
 * The direction actually flown over the last `windowMs` (ground track), from
 * the oldest pose in the window to the newest: steadier than the nose
 * heading, which wobbles from moment to moment. Null when it has moved less
 * than `minDistanceM` (hovering, or not enough history), so the caller can
 * fall back to the heading.
 */
export function trackBearingDeg(history: TimedPose[], windowMs: number, minDistanceM: number): number | null {
  const latest = history.at(-1)
  if (!latest) return null
  const oldest = history.find((p) => latest.atMs - p.atMs <= windowMs)
  if (!oldest || oldest === latest) return null
  if (haversineDistanceM(oldest.point, latest.point) < minDistanceM) return null
  return bearingDeg(oldest.point, latest.point)
}
