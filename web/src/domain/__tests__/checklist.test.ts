import { describe, expect, it } from 'vitest'
import { evaluatePreflight } from '../checklist'
import type { Mission } from '../mission'
import type { VehicleState } from '../vehicle'

function state(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicleId: 'drone-1',
    position: { lat: 0, lon: 0, altRelM: 0, altAmslM: 0 },
    attitude: { rollDeg: 0, pitchDeg: 0, yawDeg: 0 },
    groundSpeedMps: 0,
    airspeedMps: 0,
    climbMps: 0,
    battery: { voltageV: 12.6, currentA: 0, percent: 100 },
    gps: { fixType: 'fix3d', satellites: 10, hdop: 1 },
    flightMode: 'UNKNOWN',
    armed: false,
    vtolState: 'mc',
    landed: true,
    home: null,
    missionProgress: { currentIndex: 0, total: 0 },
    rc: { linked: true, overrideActive: false },
    failsafe: { gcs: false, battery: false, geofence: false, rc: false },
    updatedAt: 0,
    ...overrides,
  }
}

const validMission: Mission = {
  id: 'm1',
  name: 'test',
  items: [{ type: 'vtolTakeoff', altM: 50 }, { type: 'returnToLaunch' }],
  createdAt: 0,
  updatedAt: 0,
}

describe('evaluatePreflight', () => {
  it('is ready when everything checks out', () => {
    const result = evaluatePreflight(state(), validMission)
    expect(result.ready).toBe(true)
    expect(result.items.every((i) => i.passed)).toBe(true)
  })

  it('fails without a mission', () => {
    const result = evaluatePreflight(state(), null)
    expect(result.ready).toBe(false)
    expect(result.items.find((i) => i.id === 'missionLoaded')?.passed).toBe(false)
  })

  it('fails on low GPS fix', () => {
    const result = evaluatePreflight(state({ gps: { fixType: 'fix2d', satellites: 10, hdop: 1 } }), validMission)
    expect(result.ready).toBe(false)
    expect(result.items.find((i) => i.id === 'gpsFix')?.passed).toBe(false)
  })

  it('fails on low battery', () => {
    const result = evaluatePreflight(state({ battery: { voltageV: 11, currentA: 0, percent: 10 } }), validMission)
    expect(result.ready).toBe(false)
    expect(result.items.find((i) => i.id === 'battery')?.passed).toBe(false)
  })

  it('fails when a failsafe is active', () => {
    const result = evaluatePreflight(
      state({ failsafe: { gcs: false, battery: false, geofence: false, rc: true } }),
      validMission,
    )
    expect(result.ready).toBe(false)
    expect(result.items.find((i) => i.id === 'noFailsafe')?.passed).toBe(false)
  })

  it('fails when RC is not linked', () => {
    const result = evaluatePreflight(state({ rc: { linked: false, overrideActive: false } }), validMission)
    expect(result.ready).toBe(false)
    expect(result.items.find((i) => i.id === 'rcLinked')?.passed).toBe(false)
  })

  it('fails when the RC mode switch is off AUTO, and says where it is', () => {
    const result = evaluatePreflight(state({ rc: { linked: true, overrideActive: false, modeSwitch: 'FBWA' } }), validMission)
    expect(result.ready).toBe(false)
    const item = result.items.find((i) => i.id === 'rcSwitchAuto')
    expect(item?.passed).toBe(false)
    expect(item?.label).toContain('FBWA')
  })

  it('passes the switch check at AUTO, or when the vehicle does not report it', () => {
    for (const modeSwitch of ['AUTO', undefined] as const) {
      const result = evaluatePreflight(state({ rc: { linked: true, overrideActive: false, modeSwitch } }), validMission)
      expect(result.items.find((i) => i.id === 'rcSwitchAuto')?.passed).toBe(true)
    }
  })
})
