import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fromLocalEastNorthM } from '../../../domain/geo'
import type { Mission } from '../../../domain'
import { DroneEngine } from '../droneEngine'

const HOME = { lat: -37.861, lon: 145.062, altAmslM: 50 }
const NOON_UTC_MS = Date.UTC(2026, 0, 1, 12, 0)

function clockLoiterMission(untilUtcMinuteOfDay: number): Mission {
  const loiterPt = fromLocalEastNorthM(HOME, 300, 300)
  return {
    id: 'm',
    name: 'clock loiter',
    createdAt: 0,
    updatedAt: 0,
    items: [
      { type: 'vtolTakeoff', altM: 50 },
      { type: 'loiter', lat: loiterPt.lat, lon: loiterPt.lon, altM: 50, radiusM: 60, untilUtcMinuteOfDay },
      { type: 'returnToLaunch' },
    ],
  }
}

describe('DroneEngine clock-mode loiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOON_UTC_MS)
  })
  afterEach(() => vi.useRealTimers())

  it('ends by the real wall clock, not sim time — sped-up sim time must not make it leave early', () => {
    const engine = new DroneEngine({ home: HOME })
    engine.connect('d1')
    expect(engine.uploadMission(clockLoiterMission(12 * 60 + 10))).toMatchObject({ ok: true }) // until 12:10 UTC
    engine.applyCommand({ type: 'arm' })
    engine.applyCommand({ type: 'mission.start' })
    const phase = () => (engine as unknown as { sim: { phase: string } }).sim.phase

    // 20x speed: each tick is 0.4s of sim time but only 20ms of wall time.
    // 3000 ticks = 20 minutes of sim time, 1 minute of wall time.
    let sawLoiter = false
    for (let i = 0; i < 3000; i++) {
      vi.advanceTimersByTime(20)
      engine.tick(0.4)
      if (phase() === 'loiter') sawLoiter = true
    }
    expect(sawLoiter).toBe(true)
    expect(phase()).toBe('loiter') // still lapping: the wall clock is only at 12:01

    vi.setSystemTime(Date.UTC(2026, 0, 1, 12, 11))
    for (let i = 0; i < 1000 && phase() === 'loiter'; i++) engine.tick(0.4)
    expect(phase()).not.toBe('loiter') // past 12:10: peels off within a lap
  })
})
