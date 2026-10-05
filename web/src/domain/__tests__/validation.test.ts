import { describe, expect, it } from 'vitest'
import type { Mission, MissionItem } from '../mission'
import { estimateMissionEtaS, MIN_LOITER_RADIUS_M, validateMission } from '../validation'

function mission(items: MissionItem[], overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'm1',
    name: 'test mission',
    items,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('validateMission', () => {
  it('rejects an empty mission', () => {
    const result = validateMission(mission([]))
    expect(result.valid).toBe(false)
    expect(result.issues[0]?.message).toMatch(/no items/)
  })

  it('requires a VTOL takeoff first', () => {
    const result = validateMission(
      mission([
        { type: 'waypoint', lat: 0, lon: 0, altM: 50 },
        { type: 'vtolLand', lat: 0, lon: 0 },
      ]),
    )
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.message.includes('start with a VTOL takeoff'))).toBe(true)
  })

  it('requires a land or RTL last', () => {
    const result = validateMission(
      mission([
        { type: 'vtolTakeoff', altM: 50 },
        { type: 'waypoint', lat: 0, lon: 0, altM: 50 },
      ]),
    )
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.message.includes('end with a VTOL land'))).toBe(true)
  })

  it('accepts a minimal valid mission', () => {
    const result = validateMission(
      mission([
        { type: 'vtolTakeoff', altM: 50 },
        { type: 'waypoint', lat: 0, lon: 0, altM: 50 },
        { type: 'vtolLand', lat: 0, lon: 0 },
      ]),
    )
    expect(result.valid).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('accepts return-to-launch as the final item', () => {
    const result = validateMission(
      mission([{ type: 'vtolTakeoff', altM: 50 }, { type: 'returnToLaunch' }]),
    )
    expect(result.valid).toBe(true)
  })

  it('flags a loiter radius below the 60m minimum, and accepts one at it', () => {
    const withRadius = (radiusM: number) =>
      mission([
        { type: 'vtolTakeoff', altM: 50 },
        { type: 'loiter', lat: 0, lon: 0.01, altM: 50, radiusM },
        { type: 'returnToLaunch' },
      ])
    const tooTight = validateMission(withRadius(50))
    expect(tooTight.valid).toBe(false)
    expect(tooTight.issues[0]).toMatchObject({ itemIndex: 1 })
    expect(validateMission(withRadius(MIN_LOITER_RADIUS_M)).valid).toBe(true)
  })

  it('validates loiter laps and end times', () => {
    const withLoiter = (extra: Record<string, number>) =>
      mission([
        { type: 'vtolTakeoff', altM: 50 },
        { type: 'loiter', lat: 0, lon: 0.01, altM: 50, radiusM: 60, ...extra },
        { type: 'returnToLaunch' },
      ])
    expect(validateMission(withLoiter({ turns: 3 })).valid).toBe(true)
    expect(validateMission(withLoiter({ turns: 0 })).valid).toBe(false)
    expect(validateMission(withLoiter({ turns: 1.5 })).valid).toBe(false)
    expect(validateMission(withLoiter({ untilUtcMinuteOfDay: 870 })).valid).toBe(true)
    expect(validateMission(withLoiter({ untilUtcMinuteOfDay: 1440 })).valid).toBe(false)
  })

  it('flags altitude above the limit', () => {
    const result = validateMission(
      mission([
        { type: 'vtolTakeoff', altM: 200 },
        { type: 'vtolLand', lat: 0, lon: 0 },
      ]),
      { maxAltM: 120 },
    )
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.itemIndex === 0 && i.message.includes('exceeds the limit'))).toBe(true)
  })

  it('flags items outside the fence', () => {
    const result = validateMission(
      mission(
        [
          { type: 'vtolTakeoff', altM: 50 },
          { type: 'waypoint', lat: 10, lon: 10, altM: 50 },
          { type: 'vtolLand', lat: 0, lon: 0 },
        ],
        {
          fence: {
            polygon: [
              { lat: -1, lon: -1 },
              { lat: -1, lon: 1 },
              { lat: 1, lon: 1 },
              { lat: 1, lon: -1 },
            ],
          },
        },
      ),
    )
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.itemIndex === 1 && i.message.includes('geofence'))).toBe(true)
  })
})

describe('estimateMissionEtaS', () => {
  it('is Infinity at zero speed', () => {
    const m = mission([{ type: 'vtolTakeoff', altM: 50 }, { type: 'returnToLaunch' }])
    expect(estimateMissionEtaS(m, { lat: 0, lon: 0 }, 0)).toBe(Infinity)
  })

  it('includes loiter time, as at least one full lap around radiusM at the given speed', () => {
    // Both visit the same point, so the only difference between them is the
    // loiter's circling time, not travel distance.
    const withoutLoiter = mission([
      { type: 'vtolTakeoff', altM: 50 },
      { type: 'waypoint', lat: 0, lon: 0.01, altM: 50 },
      { type: 'vtolLand', lat: 0, lon: 0 },
    ])
    const withLoiter = mission([
      { type: 'vtolTakeoff', altM: 50 },
      { type: 'loiter', lat: 0, lon: 0.01, altM: 50, radiusM: 50 },
      { type: 'vtolLand', lat: 0, lon: 0 },
    ])
    const groundSpeedMps = 10
    const etaWithout = estimateMissionEtaS(withoutLoiter, { lat: 0, lon: 0 }, groundSpeedMps)
    const etaWith = estimateMissionEtaS(withLoiter, { lat: 0, lon: 0 }, groundSpeedMps)
    const expectedLapS = (2 * Math.PI * 50) / groundSpeedMps
    expect(etaWith - etaWithout).toBeCloseTo(expectedLapS, 0)
  })
})
