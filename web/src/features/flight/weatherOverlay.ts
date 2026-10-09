import type { GeoPoint, WindSample } from '../../domain'

/**
 * Wind sampled on a regular grid over a box, as components the air moves
 * *toward* (m/s east and north), for smooth interpolation between samples:
 * what the wind streaks flow through (ADR-0026).
 */
export interface WindGrid {
  south: number
  west: number
  north: number
  east: number
  cols: number
  rows: number
  /** Row-major, `rows` × `cols`, south row first (as gridPoints makes them). */
  eastMps: number[]
  northMps: number[]
}

/** The grid from samples taken at gridPoints over the same box. Each sample
 * goes in the cell its point is in; a cell with none stays calm. */
export function buildWindGrid(samples: WindSample[], south: number, west: number, north: number, east: number, cols: number, rows: number): WindGrid {
  const eastMps = new Array<number>(cols * rows).fill(0)
  const northMps = new Array<number>(cols * rows).fill(0)
  for (const s of samples) {
    const c = Math.min(cols - 1, Math.max(0, Math.floor(((s.point.lon - west) / (east - west)) * cols)))
    const r = Math.min(rows - 1, Math.max(0, Math.floor(((s.point.lat - south) / (north - south)) * rows)))
    const toRad = ((s.fromDeg + 180) * Math.PI) / 180
    eastMps[r * cols + c] = s.speedMps * Math.sin(toRad)
    northMps[r * cols + c] = s.speedMps * Math.cos(toRad)
  }
  return { south, west, north, east, cols, rows, eastMps, northMps }
}

/** The wind at a point, blended from the four nearest samples (and held at
 * the edge value outside the grid). */
export function windAt(grid: WindGrid, point: GeoPoint): { eastMps: number; northMps: number; speedMps: number } {
  // Sample (c, r) sits at the centre of its cell.
  const x = Math.min(grid.cols - 1, Math.max(0, ((point.lon - grid.west) / (grid.east - grid.west)) * grid.cols - 0.5))
  const y = Math.min(grid.rows - 1, Math.max(0, ((point.lat - grid.south) / (grid.north - grid.south)) * grid.rows - 0.5))
  const c0 = Math.floor(x)
  const r0 = Math.floor(y)
  const c1 = Math.min(grid.cols - 1, c0 + 1)
  const r1 = Math.min(grid.rows - 1, r0 + 1)
  const fx = x - c0
  const fy = y - r0
  const blend = (v: number[]) => {
    const at = (r: number, c: number) => v[r * grid.cols + c] ?? 0
    return (at(r0, c0) * (1 - fx) + at(r0, c1) * fx) * (1 - fy) + (at(r1, c0) * (1 - fx) + at(r1, c1) * fx) * fy
  }
  const eastMps = blend(grid.eastMps)
  const northMps = blend(grid.northMps)
  return { eastMps, northMps, speedMps: Math.hypot(eastMps, northMps) }
}
