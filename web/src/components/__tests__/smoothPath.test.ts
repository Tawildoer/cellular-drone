import { describe, expect, it } from 'vitest'
import { smoothPath } from '../smoothPath'

/** The control points' y values, in order. */
function controlYs(d: string): number[] {
  return [...d.matchAll(/C([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)/g)].flatMap((m) => [Number(m[2]), Number(m[4])])
}

describe('smoothPath', () => {
  it('handles no points and one point', () => {
    expect(smoothPath([])).toBe('')
    expect(smoothPath([{ x: 1, y: 2 }])).toBe('M1.0 2.0')
  })

  it('passes through every point', () => {
    const d = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 2 }])
    expect(d.startsWith('M0.0 0.0')).toBe(true)
    expect(d).toContain(' 10.0 5.0C')
    expect(d.endsWith(' 20.0 2.0')).toBe(true)
  })

  it('stays flat between equal readings and never overshoots a peak', () => {
    const d = smoothPath([{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 10 }])
    const ys = controlYs(d)
    expect(ys.slice(0, 2)).toEqual([10, 10]) // the flat stretch
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...ys)).toBeLessThanOrEqual(10)
  })
})
