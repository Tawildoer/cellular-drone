import type { FeatureCollection } from 'geojson'
import type { ExpressionSpecification } from 'maplibre-gl'
import {
  bearingDeg,
  cellSignalLevel,
  coverageNear,
  groundSpeedMps,
  haversineDistanceM,
  headwindMps,
  pathColorScale,
  PATH_COLOR_METRICS,
  type CoverageIndex,
  type PathColorMetric,
  type PathColorScale,
  type WindVector,
} from '../../domain'
import type { RouteValue, TrailValue } from './flightMapGeo'

/**
 * Colouring the flown trail and the planned route by one value (an operator
 * setting): wind along the track, cell signal, height or ground speed. The
 * geometry builders tag each piece of path with its value `v`
 * (flightMapGeo.ts); the colours here turn `v` into paint. Without a value
 * (cell signal where it hasn't flown, wind with no reading) a piece is grey.
 *
 * Colours follow the chart palette: one blue for magnitude (height, speed),
 * blue tail to red head round a grey calm for wind, and the fixed status
 * colours for the cell signal's bands, always shown with their names.
 */

const METRIC_KEY = 'cellular-drone:path-color'

export function readPathColorMetric(): PathColorMetric {
  try {
    const saved = localStorage.getItem(METRIC_KEY)
    return PATH_COLOR_METRICS.includes(saved as PathColorMetric) ? (saved as PathColorMetric) : 'off'
  } catch {
    return 'off'
  }
}

export function savePathColorMetric(metric: PathColorMetric): void {
  try {
    localStorage.setItem(METRIC_KEY, metric)
  } catch {
    // Only a remembered preference.
  }
}

export const PATH_COLOR_LABELS: Record<PathColorMetric, string> = {
  off: 'Off',
  wind: 'Wind',
  cell: 'Cell signal',
  height: 'Height',
  speed: 'Speed',
}

/** The sequential ramp, light (low) to dark (high), from the palette's
 * blue, bounded so both ends still show on the street and satellite maps. */
export const MAGNITUDE_RAMP = ['#9ec5f4', '#5598e7', '#256abf', '#184f95']
export const WIND_TAIL = '#2a78d6'
export const WIND_CALM = '#b9b8b3'
export const WIND_HEAD = '#e34948'
/** Cell bands, poor to strong: the status colours. */
export const CELL_COLORS = ['#d03b3b', '#ec835a', '#fab219', '#0ca30c']
export const NO_DATA_COLOR = '#7c7c78'

/** Shorter than this, a trail segment's track is GPS noise. */
const MIN_SEGMENT_M = 0.5

export function trailValueFn(metric: PathColorMetric): TrailValue | undefined {
  switch (metric) {
    case 'off':
      return undefined
    case 'wind':
      return (a, b) => {
        const wind = b.conditions?.wind
        if (!wind || haversineDistanceM(a.point, b.point) < MIN_SEGMENT_M) return undefined
        return headwindMps(bearingDeg(a.point, b.point), wind)
      }
    case 'cell':
      return (_a, b) => (b.conditions?.cellular ? cellSignalLevel(b.conditions.cellular) : undefined)
    case 'height':
      return (a, b) => (a.altM + b.altM) / 2
    case 'speed':
      return (_a, b) => b.conditions?.groundSpeedMps
  }
}

export interface RouteContext {
  /** Measured, else forecast; one for the whole route. */
  wind: WindVector | null
  cruiseMps: number
  coverage: CoverageIndex
}

export function routeValueFn(metric: PathColorMetric, ctx: RouteContext): RouteValue | undefined {
  switch (metric) {
    case 'off':
      return undefined
    case 'wind':
      return (_at, _altM, trackDeg) => (ctx.wind ? headwindMps(trackDeg, ctx.wind) : undefined)
    case 'cell':
      return (at, altM) => {
        const seen = coverageNear(ctx.coverage, at, altM)
        return seen ? cellSignalLevel(seen) : undefined
      }
    case 'height':
      return (_at, altM) => altM
    case 'speed':
      return (_at, _altM, trackDeg) => groundSpeedMps(ctx.cruiseMps, trackDeg, ctx.wind)
  }
}

/** Every `v` in some built paths, for the scale. */
export function pathValues(...collections: FeatureCollection[]): number[] {
  const values: number[] = []
  for (const fc of collections) {
    for (const f of fc.features) {
      const v: unknown = f.properties?.v
      if (typeof v === 'number') values.push(v)
    }
  }
  return values
}

/** Rounded so the paint is only re-set when the scale really moves. */
export function roundedScale(metric: PathColorMetric, values: number[]): PathColorScale | null {
  const scale = pathColorScale(metric, values)
  if (!scale) return null
  const step = metric === 'height' ? 5 : 1
  return { min: Math.floor(scale.min / step) * step, max: Math.ceil(scale.max / step) * step }
}

/** The paint colour for pieces carrying `v`, grey without one. */
export function pathColorExpression(metric: PathColorMetric, scale: PathColorScale | null): ExpressionSpecification | null {
  let ramp: ExpressionSpecification
  switch (metric) {
    case 'off':
      return null
    case 'cell':
      ramp = ['step', ['get', 'v'], CELL_COLORS[0]!, 1, CELL_COLORS[1]!, 2, CELL_COLORS[2]!, 3, CELL_COLORS[3]!]
      break
    case 'wind': {
      const reach = scale?.max ?? 3
      ramp = ['interpolate', ['linear'], ['get', 'v'], -reach, WIND_TAIL, 0, WIND_CALM, reach, WIND_HEAD]
      break
    }
    case 'height':
    case 'speed': {
      const min = scale?.min ?? 0
      const max = Math.max(min + 1, scale?.max ?? 1)
      const stops = MAGNITUDE_RAMP.flatMap((color, i) => [min + ((max - min) * i) / (MAGNITUDE_RAMP.length - 1), color])
      ramp = ['interpolate', ['linear'], ['get', 'v'], ...stops] as ExpressionSpecification
      break
    }
  }
  return ['case', ['has', 'v'], ramp, NO_DATA_COLOR]
}
