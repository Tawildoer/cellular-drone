import { describe, expect, it } from 'vitest'
import { addCoverageSample, cellSignalLevel, coverageNear, indexCoverage, pathColorScale, type CoverageSample } from '../pathColor'
import { fromLocalEastNorthM } from '../geo'

const HOME = { lat: -37.861, lon: 145.062 }

function sample(eastM: number, northM: number, rsrpDbm: number, sinrDb: number, altM = 100): CoverageSample {
  return { ...fromLocalEastNorthM(HOME, eastM, northM), altM, rsrpDbm, sinrDb, atMs: 0 }
}

describe('cell signal level', () => {
  it('is the worse of strength and quality', () => {
    expect(cellSignalLevel({ rsrpDbm: -80, sinrDb: 20 })).toBe(3)
    expect(cellSignalLevel({ rsrpDbm: -80, sinrDb: 2 })).toBe(1)
    expect(cellSignalLevel({ rsrpDbm: -105, sinrDb: 20 })).toBe(1)
    expect(cellSignalLevel({ rsrpDbm: -95, sinrDb: 8 })).toBe(2)
    expect(cellSignalLevel({ rsrpDbm: -120, sinrDb: -3 })).toBe(0)
  })
})

describe('path colour scale', () => {
  it('has fixed bands for cell signal, and none when off', () => {
    expect(pathColorScale('cell', [1, 2])).toBeNull()
    expect(pathColorScale('off', [1, 2])).toBeNull()
  })

  it('is symmetric round calm for wind, at least 3 m/s either way', () => {
    expect(pathColorScale('wind', [-1, 0.5])).toEqual({ min: -3, max: 3 })
    expect(pathColorScale('wind', [-2, 6])).toEqual({ min: -6, max: 6 })
  })

  it('spans the values for height and speed, widened when they barely vary', () => {
    expect(pathColorScale('height', [40, 120, 80])).toEqual({ min: 40, max: 120 })
    expect(pathColorScale('height', [60, 62])).toEqual({ min: 56, max: 66 })
    expect(pathColorScale('speed', [])).toBeNull()
    expect(pathColorScale('speed', [1])).toEqual({ min: 0, max: 3 })
  })
})

describe('coverage memory', () => {
  it('keeps one reading per square and height band, the newest', () => {
    let samples = addCoverageSample([], sample(20, 20, -90, 10))
    samples = addCoverageSample(samples, { ...sample(22, 22, -100, 3), atMs: 1 })
    expect(samples).toHaveLength(1)
    expect(samples[0]!.rsrpDbm).toBe(-100)
    samples = addCoverageSample(samples, sample(20, 20, -95, 6, 0))
    expect(samples).toHaveLength(2)
  })

  it('drops the oldest past the cap', () => {
    let samples: CoverageSample[] = []
    for (let i = 0; i < 5; i++) samples = addCoverageSample(samples, sample(i * 100, 0, -90 - i, 10), 3)
    expect(samples.map((s) => s.rsrpDbm)).toEqual([-92, -93, -94])
  })

  it('answers with nearby readings at about the same height, else nothing', () => {
    const index = indexCoverage([sample(0, 0, -90, 10), sample(40, 0, -100, 4), sample(500, 0, -110, 0)])
    expect(coverageNear(index, fromLocalEastNorthM(HOME, 20, 0), 100)).toEqual({ rsrpDbm: -95, sinrDb: 7 })
    expect(coverageNear(index, fromLocalEastNorthM(HOME, 20, 0), 10)).toBeNull()
    expect(coverageNear(index, fromLocalEastNorthM(HOME, 250, 0), 100)).toBeNull()
  })
})
