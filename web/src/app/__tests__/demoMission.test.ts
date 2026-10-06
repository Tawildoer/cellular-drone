import { describe, expect, it } from 'vitest'
import { itemPosition, pathLengthM, validateMission, type GeoPoint } from '../../domain'
import { DEMO_MISSION } from '../config'

describe('DEMO_MISSION', () => {
  // The sim refuses an invalid mission without telling anyone, leaving the
  // demo drone parked on the ground.
  it('passes mission validation', () => {
    expect(validateMission(DEMO_MISSION).issues).toEqual([])
  })

  it('is a long route, with every leg under the floating path’s 3km dash cap', () => {
    const points = DEMO_MISSION.items.map(itemPosition).filter((p): p is GeoPoint => p !== null)
    expect(pathLengthM(points)).toBeGreaterThan(10_000)
    const legsM = points.slice(1).map((p, i) => pathLengthM([points[i] ?? p, p]))
    expect(Math.max(...legsM)).toBeLessThan(3_000)
  })
})
