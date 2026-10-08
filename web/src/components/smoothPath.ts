export interface PathPoint {
  x: number
  y: number
}

/**
 * An SVG path through the points as a smooth curve that never overshoots
 * them (monotone cubic, Fritsch–Carlson): between two equal readings it
 * stays flat, and it never draws a peak or dip the data doesn't have.
 * Points must be in increasing x.
 */
export function smoothPath(points: PathPoint[]): string {
  const n = points.length
  if (n === 0) return ''
  const first = points[0]!
  if (n === 1) return `M${first.x.toFixed(1)} ${first.y.toFixed(1)}`

  const slopes: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    slopes.push(b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x))
  }
  // Tangents: the mean of the neighbouring slopes, zero at a turning point.
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0]!
    if (i === n - 1) return slopes[n - 2]!
    const s0 = slopes[i - 1]!
    const s1 = slopes[i]!
    return s0 * s1 <= 0 ? 0 : (s0 + s1) / 2
  })
  // Fritsch–Carlson limit, so no segment overshoots.
  for (let i = 0; i < n - 1; i++) {
    const s = slopes[i]!
    if (s === 0) {
      tangents[i] = 0
      tangents[i + 1] = 0
      continue
    }
    const a = tangents[i]! / s
    const b = tangents[i + 1]! / s
    const h = Math.hypot(a, b)
    if (h > 3) {
      tangents[i] = (3 * a * s) / h
      tangents[i + 1] = (3 * b * s) / h
    }
  }

  let d = `M${first.x.toFixed(1)} ${first.y.toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const dx = (b.x - a.x) / 3
    d +=
      `C${(a.x + dx).toFixed(1)} ${(a.y + tangents[i]! * dx).toFixed(1)}` +
      ` ${(b.x - dx).toFixed(1)} ${(b.y - tangents[i + 1]! * dx).toFixed(1)}` +
      ` ${b.x.toFixed(1)} ${b.y.toFixed(1)}`
  }
  return d
}
