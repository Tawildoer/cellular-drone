import type { GeoPoint } from './mission'

/** Wind at one point (ADR-0026). Direction is where it blows *from*, as
 * forecasts give it; arrows on the map point the way it blows. */
export interface WindSample {
  point: GeoPoint
  speedMps: number
  fromDeg: number
  /** Gusts near the ground (10 m), where the forecast has them. */
  gustMps: number | null
}

/** A wind reading set: the samples, the height they're for and when the
 * forecast is valid (epoch ms). */
export interface WindField {
  samples: WindSample[]
  heightM: number
  validAtMs: number
}

/** The latest rain-radar frame as map tiles ({z}/{x}/{y} URL template). */
export interface RadarFrame {
  tileUrl: string
  timeMs: number
  /** Deepest zoom the tiles exist at; the map enlarges beyond it. */
  maxZoom: number
}

/** Up to this wind (m/s) the small QuadPlane is comfortable; beyond
 * WIND_STRONG_MPS it's a struggle (SITL cruises at 25 m/s). Colours the
 * wind arrows. */
export const WIND_MODERATE_MPS = 5
export const WIND_STRONG_MPS = 10

/** A `cols` × `rows` grid of points across a box, inset from its edges. */
export function gridPoints(south: number, west: number, north: number, east: number, cols: number, rows: number): GeoPoint[] {
  const points: GeoPoint[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push({ lat: south + ((r + 0.5) / rows) * (north - south), lon: west + ((c + 0.5) / cols) * (east - west) })
    }
  }
  return points
}

/** A wind: how strong, and where it blows from (meteorological, as ArduPilot
 * and forecasts give it). */
export interface WindVector {
  speedMps: number
  fromDeg: number
}

/** How much of the wind is against a track (m/s): positive a headwind,
 * negative a tailwind. */
export function headwindMps(trackDeg: number, wind: WindVector | null | undefined): number {
  if (!wind) return 0
  return -wind.speedMps * Math.cos(((wind.fromDeg + 180 - trackDeg) * Math.PI) / 180)
}

/** Below this the aircraft is barely making headway; estimates use it
 * rather than dividing by nothing. */
const MIN_GROUND_SPEED_MPS = 1

/**
 * Ground speed flying `trackDeg` at `airspeedMps` through `wind`: the
 * aircraft crabs into the crosswind to hold its track, and the along-track
 * wind adds or takes away. Calm, it's the airspeed.
 */
export function groundSpeedMps(airspeedMps: number, trackDeg: number, wind: WindVector | null | undefined): number {
  if (!wind || wind.speedMps <= 0) return airspeedMps
  const rel = ((wind.fromDeg + 180 - trackDeg) * Math.PI) / 180
  const tail = wind.speedMps * Math.cos(rel)
  const cross = wind.speedMps * Math.sin(rel)
  const along = Math.sqrt(Math.max(0, airspeedMps ** 2 - cross ** 2))
  return Math.max(MIN_GROUND_SPEED_MPS, along + tail)
}

/** A leg's wind, for tinting the route: a tailwind, a headwind worth
 * noticing, a strong one, or nothing to speak of. */
export type WindTint = 'tail' | 'none' | 'head' | 'strongHead'
export const HEADWIND_NOTABLE_MPS = 3
export const HEADWIND_STRONG_MPS = 7

export function legWindTint(trackDeg: number, wind: WindVector | null | undefined): WindTint {
  const head = headwindMps(trackDeg, wind)
  if (head >= HEADWIND_STRONG_MPS) return 'strongHead'
  if (head >= HEADWIND_NOTABLE_MPS) return 'head'
  if (head <= -HEADWIND_NOTABLE_MPS) return 'tail'
  return 'none'
}
