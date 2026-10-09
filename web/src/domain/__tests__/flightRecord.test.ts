import { describe, expect, it } from 'vitest'
import { fromLocalEastNorthM } from '../geo'
import type { Mission } from '../mission'
import { IDLE_RECORDER, recordFlight, type FlightRecorder } from '../flightRecord'
import type { VehicleState } from '../vehicle'

const HOME = { lat: -37.861, lon: 145.062 }
const mission: Mission = {
  id: 'm1',
  name: 'Patrol',
  createdAt: 0,
  updatedAt: 0,
  items: [{ type: 'vtolTakeoff', altM: 40 }, { type: 'waypoint', ...fromLocalEastNorthM(HOME, 0, 1000), altM: 60 }, { type: 'returnToLaunch' }],
}

function state(over: Partial<VehicleState> & { northM?: number } = {}): VehicleState {
  const { northM = 0, ...rest } = over
  const p = fromLocalEastNorthM(HOME, 0, northM)
  return {
    vehicleId: 'v1',
    position: { ...p, altRelM: 50, altAmslM: 100 },
    attitude: { rollDeg: 0, pitchDeg: 0, yawDeg: 0 },
    groundSpeedMps: 25,
    airspeedMps: 25,
    climbMps: 0,
    battery: { voltageV: 24, currentA: 10, percent: 90 },
    gps: { fixType: 'fix3d', satellites: 12, hdop: 1 },
    flightMode: 'AUTO',
    armed: true,
    vtolState: 'fw',
    landed: false,
    home: { ...HOME, altAmslM: 50 },
    missionProgress: { currentIndex: 1, total: 3 },
    rc: { linked: true, overrideActive: false },
    failsafe: { gcs: false, battery: false, geofence: false, rc: false },
    updatedAt: 0,
    ...rest,
  }
}

function fly(steps: VehicleState[]) {
  let recorder: FlightRecorder = IDLE_RECORDER
  const finished = []
  for (const [i, s] of steps.entries()) {
    const out = recordFlight(recorder, s, mission, 1000 * i, () => `f${i}`)
    recorder = out.recorder
    if (out.finished) finished.push(out.finished)
  }
  return { recorder, finished }
}

describe('recordFlight', () => {
  it("doesn't start on the ground, armed or not", () => {
    expect(fly([state({ armed: false, landed: true }), state({ landed: true })]).recorder.active).toBeNull()
  })

  it('records a flight from takeoff to touchdown, with its stats', () => {
    const { finished } = fly([
      state({ northM: 0, missionProgress: { currentIndex: 0, total: 3 }, battery: { voltageV: 24, currentA: 10, percent: 95 } }),
      state({ northM: 500, position: { ...fromLocalEastNorthM(HOME, 0, 500), altRelM: 80, altAmslM: 130 } }),
      state({ northM: 1000, missionProgress: { currentIndex: 2, total: 3 } }),
      state({ northM: 0, missionProgress: { currentIndex: 2, total: 3 }, battery: { voltageV: 22, currentA: 0, percent: 70 }, landed: true }),
    ])
    expect(finished).toHaveLength(1)
    const f = finished[0]!
    expect(f).toMatchObject({ missionName: 'Patrol', startedAt: 0, endedAt: 3000, maxAltM: 80, furthestItem: 2, totalItems: 3 })
    expect(f).toMatchObject({ batteryStartPct: 95, batteryEndPct: 70, outcome: 'completed' })
    expect(Math.round(f.distanceM / 10) * 10).toBe(2000)
  })

  it('tells an early RTL, a QLAND and a pilot takeover apart', () => {
    const end = (over: Partial<VehicleState>) =>
      fly([state(), state(over), state({ ...over, landed: true })]).finished[0]?.outcome
    expect(end({ flightMode: 'RTL' })).toBe('returned')
    expect(end({ flightMode: 'QLAND' })).toBe('landedHere')
    expect(end({ flightMode: 'FBWA', rc: { linked: true, overrideActive: true } })).toBe('pilot')
  })

  it('judges the outcome from the last mode in the air, not the touchdown update', () => {
    const { finished } = fly([state(), state({ flightMode: 'RTL' }), state({ flightMode: 'UNKNOWN', landed: true })])
    expect(finished[0]?.outcome).toBe('returned')
  })

  it("doesn't name a mission the vehicle isn't flying", () => {
    const { finished } = fly([state({ missionProgress: { currentIndex: 0, total: 9 } }), state({ landed: true })])
    expect(finished[0]?.missionName).toBeNull()
  })
})
