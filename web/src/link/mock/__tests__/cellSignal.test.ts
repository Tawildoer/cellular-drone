import { describe, expect, it } from 'vitest'
import { fromLocalEastNorthM } from '../../../domain'
import { simulatedCellSignal } from '../cellSignal'

const HOME = { lat: -37.861, lon: 145.062 }
const still = () => 0.5

describe('mock cell signal', () => {
  it('is the same at the same place and height', () => {
    const p = fromLocalEastNorthM(HOME, 700, -300)
    expect(simulatedCellSignal(HOME, p, 80, still)).toEqual(simulatedCellSignal(HOME, p, 80, still))
  })

  it('stays in a realistic range across the flying area', () => {
    for (let e = -3000; e <= 3000; e += 500) {
      for (let n = -3000; n <= 3000; n += 500) {
        for (const alt of [0, 60, 120]) {
          const s = simulatedCellSignal(HOME, fromLocalEastNorthM(HOME, e, n), alt, still)
          expect(s.rsrpDbm).toBeGreaterThan(-130)
          expect(s.rsrpDbm).toBeLessThan(-50)
          expect(s.sinrDb).toBeGreaterThan(-10)
          expect(s.sinrDb).toBeLessThanOrEqual(30)
          expect(s.band).toMatch(/^B\d+$/)
        }
      }
    }
  })

  it('up high, is stronger but noisier, as other towers come into view', () => {
    const p = fromLocalEastNorthM(HOME, 0, 0)
    const ground = simulatedCellSignal(HOME, p, 0, still)
    const high = simulatedCellSignal(HOME, p, 120, still)
    expect(high.rsrpDbm).toBeGreaterThan(ground.rsrpDbm)
    expect(high.sinrDb).toBeLessThan(ground.sinrDb)
  })
})
