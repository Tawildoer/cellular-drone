import { haversineDistanceM } from './geo'
import type { GeoPoint } from './mission'
import type { CellularSignal } from './vehicle'

/** What the flown trail and the planned route can be coloured by (an
 * operator setting). `off` keeps their usual colours. */
export type PathColorMetric = 'off' | 'wind' | 'cell' | 'height' | 'speed'
export const PATH_COLOR_METRICS: readonly PathColorMetric[] = ['off', 'wind', 'cell', 'height', 'speed']

/** Cell signal in four bands, 0 poor to 3 strong: the worse of strength
 * (RSRP) and quality (SINR). Up high the drone sees many towers at once, so
 * strength often holds while quality falls; either can starve the link. */
export type CellLevel = 0 | 1 | 2 | 3
export const CELL_LEVEL_LABELS: Record<CellLevel, string> = { 0: 'Poor', 1: 'Weak', 2: 'Fair', 3: 'Strong' }
/** Band floors, strongest first: RSRP (dBm) and SINR (dB) at or above these. */
const RSRP_FLOORS_DBM = [-90, -100, -110]
const SINR_FLOORS_DB = [13, 5, 0]

function levelFrom(value: number, floors: number[]): CellLevel {
  const i = floors.findIndex((f) => value >= f)
  return (i === -1 ? 0 : 3 - i) as CellLevel
}

export function cellSignalLevel(signal: Pick<CellularSignal, 'rsrpDbm' | 'sinrDb'>): CellLevel {
  return Math.min(levelFrom(signal.rsrpDbm, RSRP_FLOORS_DBM), levelFrom(signal.sinrDb, SINR_FLOORS_DB)) as CellLevel
}

/** The range a relative metric's colours span. Wind is symmetric round
 * calm (tail negative, head positive); height and speed run low to high. */
export interface PathColorScale {
  min: number
  max: number
}

/** Narrower than this, a scale would paint small wobbles as big changes. */
const MIN_SPAN: Record<'wind' | 'height' | 'speed', number> = { wind: 3, height: 10, speed: 4 }

/** The scale for `values` (relative: the flight's own lowest to highest),
 * or null for cell signal, whose bands are fixed, and for `off`. */
export function pathColorScale(metric: PathColorMetric, values: number[]): PathColorScale | null {
  if (metric === 'off' || metric === 'cell') return null
  const finite = values.filter(Number.isFinite)
  if (metric === 'wind') {
    const reach = Math.max(MIN_SPAN.wind, ...finite.map(Math.abs))
    return { min: -reach, max: reach }
  }
  if (finite.length === 0) return null
  let min = Math.min(...finite)
  let max = Math.max(...finite)
  const short = MIN_SPAN[metric] - (max - min)
  if (short > 0) {
    min -= short / 2
    max += short / 2
  }
  if (metric === 'height' || metric === 'speed') min = Math.max(0, min)
  return { min, max }
}

// --- Coverage memory --------------------------------------------------------

/** One cell-signal reading, where and when it was taken. */
export interface CoverageSample {
  lat: number
  lon: number
  /** Height above home. */
  altM: number
  rsrpDbm: number
  sinrDb: number
  /** epoch ms */
  atMs: number
}

/** Readings are kept one per grid square (about 30 m) and height band, the
 * newest winning: a coverage map, not a log. */
const GRID_DEG = 0.0003
const ALT_BAND_M = 40
/** How far from a reading it still says something about the signal. */
export const COVERAGE_REACH_M = 80
export const MAX_COVERAGE_SAMPLES = 5000

function gridKey(lat: number, lon: number): string {
  return `${Math.floor(lat / GRID_DEG)},${Math.floor(lon / GRID_DEG)}`
}

function altBand(altM: number): number {
  return Math.round(altM / ALT_BAND_M)
}

/** Adds a reading, replacing an older one in the same square and height
 * band; the oldest drop off past `max`. */
export function addCoverageSample(samples: CoverageSample[], sample: CoverageSample, max = MAX_COVERAGE_SAMPLES): CoverageSample[] {
  const key = gridKey(sample.lat, sample.lon)
  const band = altBand(sample.altM)
  const rest = samples.filter((s) => gridKey(s.lat, s.lon) !== key || altBand(s.altM) !== band)
  rest.push(sample)
  return rest.length > max ? rest.slice(rest.length - max) : rest
}

/** Readings by grid square, for lookups along a route. */
export type CoverageIndex = Map<string, CoverageSample[]>

export function indexCoverage(samples: CoverageSample[]): CoverageIndex {
  const index: CoverageIndex = new Map()
  for (const s of samples) {
    const key = gridKey(s.lat, s.lon)
    const list = index.get(key)
    if (list) list.push(s)
    else index.set(key, [s])
  }
  return index
}

/** What earlier flights measured near `point` at about `altM`: the mean of
 * readings within COVERAGE_REACH_M and a height band either side, or null
 * where it hasn't flown. */
export function coverageNear(index: CoverageIndex, point: GeoPoint, altM: number): Pick<CellularSignal, 'rsrpDbm' | 'sinrDb'> | null {
  const row = Math.floor(point.lat / GRID_DEG)
  const col = Math.floor(point.lon / GRID_DEG)
  const reachCells = Math.ceil(COVERAGE_REACH_M / (GRID_DEG * 111_320 * Math.max(0.2, Math.cos((point.lat * Math.PI) / 180))))
  let rsrp = 0
  let sinr = 0
  let n = 0
  for (let r = row - reachCells; r <= row + reachCells; r++) {
    for (let c = col - reachCells; c <= col + reachCells; c++) {
      for (const s of index.get(`${r},${c}`) ?? []) {
        if (Math.abs(s.altM - altM) > ALT_BAND_M) continue
        if (haversineDistanceM(point, s) > COVERAGE_REACH_M) continue
        rsrp += s.rsrpDbm
        sinr += s.sinrDb
        n++
      }
    }
  }
  return n === 0 ? null : { rsrpDbm: rsrp / n, sinrDb: sinr / n }
}
