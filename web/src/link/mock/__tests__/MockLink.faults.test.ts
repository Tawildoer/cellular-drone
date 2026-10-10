import { describe, expect, it } from 'vitest'
import type { Mission, VehicleEvent, VehicleState } from '../../../domain'
import { MockLink } from '../MockLink'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition')
    await delay(10)
  }
}

function sampleMission(): Mission {
  return {
    id: 'm1',
    name: 'fault test',
    items: [
      { type: 'vtolTakeoff', altM: 30 },
      { type: 'vtolLand', lat: 0, lon: 0 },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

describe('MockLink fault injection', () => {
  it('delays command responses by the configured latency', async () => {
    const link = new MockLink({ tickMs: 20 })
    await link.connect('v1')
    link.setFaultConfig({ latencyMs: 150 })

    const start = Date.now()
    await link.send({ type: 'disarm' })
    expect(Date.now() - start).toBeGreaterThanOrEqual(140)

    await link.disconnect()
  })

  it('drops telemetry at the configured loss rate', async () => {
    const link = new MockLink({ tickMs: 10 })
    link.setFaultConfig({ lossRate: 1 })
    const states: VehicleState[] = []
    link.onState((s) => states.push(s))

    await link.connect('v1')
    await delay(100)

    expect(states.length).toBe(0)
    await link.disconnect()
  })

  it('reports disconnected and fails commands with timeout when the link is dropped', async () => {
    const link = new MockLink({ tickMs: 20 })
    await link.connect('v1')
    link.setFaultConfig({ linkDropped: true })
    await delay(50)

    const result = await link.send({ type: 'disarm' })
    expect(result).toEqual({ ok: false, reason: 'timeout' })

    await link.disconnect()
  })

  it('keeps flying while the link is dropped, and reports where it got to', async () => {
    // 50× speed: each 20 ms tick is a simulated second.
    const link = new MockLink({ tickMs: 20, timeScale: 50 })
    await link.connect('v1')
    link.setFaultConfig({ linkDropped: true })
    await delay(150)
    const next = new Promise<VehicleState>((resolve) => {
      const off = link.onState((s) => {
        off()
        resolve(s)
      })
    })
    link.setFaultConfig({ linkDropped: false })
    // GPS reaches a 3D fix two simulated seconds after connecting: only if
    // the simulation ran on while the link was down.
    expect((await next).gps.fixType).toBe('fix3d')
    await link.disconnect()
  })

  it('blocks flight-affecting commands while RC override is active', async () => {
    const link = new MockLink({ tickMs: 20 })
    await link.connect('v1')
    link.setFaultConfig({ rcOverrideActive: true })

    const result = await link.send({ type: 'arm' })
    expect(result).toEqual({ ok: false, reason: 'blocked_rc_override', detail: 'RC override is active' })

    await link.disconnect()
  })

  it('does not block video.config while RC override is active', async () => {
    const link = new MockLink({ tickMs: 20 })
    await link.connect('v1')
    link.setFaultConfig({ rcOverrideActive: true })

    const result = await link.send({ type: 'video.config', preset: 'low' })
    expect(result).toEqual({ ok: true })

    await link.disconnect()
  })

  it('emits an rcOverride event when the fault is toggled', async () => {
    const link = new MockLink({ tickMs: 20 })
    const events: unknown[] = []
    link.onEvent((e) => events.push(e))
    await link.connect('v1')

    link.setFaultConfig({ rcOverrideActive: true })
    expect(events).toContainEqual(expect.objectContaining({ kind: 'rcOverride', active: true }))

    link.setFaultConfig({ rcOverrideActive: false })
    expect(events).toContainEqual(expect.objectContaining({ kind: 'rcOverride', active: false }))

    await link.disconnect()
  })

  it('forces the battery down and raises the battery failsafe', async () => {
    const link = new MockLink({ tickMs: 10 })
    const states: VehicleState[] = []
    const events: unknown[] = []
    link.onState((s) => states.push(s))
    link.onEvent((e) => events.push(e))

    await link.connect('v1')
    link.setFaultConfig({ lowBattery: true })
    await waitFor(() => states.some((s) => s.failsafe.battery))

    const last = states[states.length - 1]
    expect(last?.battery.percent).toBeLessThanOrEqual(15)
    expect(last?.failsafe.battery).toBe(true)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'failsafe', flag: 'battery', active: true }))

    await link.disconnect()
  })

  it('forces an arbitrary failsafe flag active via setFaultConfig', async () => {
    const link = new MockLink({ tickMs: 10 })
    const states: VehicleState[] = []
    link.onState((s) => states.push(s))

    await link.connect('v1')
    link.setFaultConfig({ failsafe: { gcs: false, battery: false, geofence: true, rc: false } })
    await waitFor(() => states.some((s) => s.failsafe.geofence))

    expect(states[states.length - 1]?.failsafe.geofence).toBe(true)
    await link.disconnect()
  })

  it('setTimeScale speeds up the simulation live, without reconnecting', async () => {
    const link = new MockLink({ tickMs: 20, timeScale: 1, home: { lat: 0, lon: 0, altAmslM: 0 } })
    const states: VehicleState[] = []
    link.onState((s) => states.push(s))

    await link.connect('v1')
    await link.send({ type: 'arm' })
    await link.uploadMission(sampleMission())
    await link.send({ type: 'mission.start' })

    expect(link.getTimeScale()).toBe(1)
    link.setTimeScale(50)
    expect(link.getTimeScale()).toBe(50)

    // At 50x, a handful of 20ms ticks covers a full second of climb (3m/s) —
    // comfortably reachable quickly if the new scale actually took effect.
    await waitFor(() => states.some((s) => s.position.altRelM > 5), 2000)

    await link.disconnect()
  })

  it('lookAheadM is readable/settable via the existing fault-config channel', async () => {
    const link = new MockLink({ tickMs: 20 })
    await link.connect('v1')

    expect(link.getFaultConfig().lookAheadM).toBeGreaterThan(0)
    link.setFaultConfig({ lookAheadM: 80 })
    expect(link.getFaultConfig().lookAheadM).toBe(80)

    await link.disconnect()
  })

  it('flies a full mission end to end and reports battery drain', async () => {
    const link = new MockLink({ tickMs: 20, timeScale: 20, home: { lat: 0, lon: 0, altAmslM: 0 } })
    const states: VehicleState[] = []
    const events: VehicleEvent[] = []
    link.onState((s) => states.push(s))
    link.onEvent((e) => events.push(e))

    await link.connect('v1')
    await link.send({ type: 'arm' })
    await link.uploadMission(sampleMission())
    const startResult = await link.send({ type: 'mission.start' })
    expect(startResult).toEqual({ ok: true })

    await waitFor(() => states.some((s) => s.vtolState === 'transition'), 4000)
    await waitFor(() => states.some((s) => s.armed && s.landed && s.vtolState === 'mc'), 8000)

    expect(states[states.length - 1]?.battery.percent).toBeLessThan(100)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'modeChanged', mode: 'AUTO' }))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'modeChanged', mode: 'QLAND' }))

    await link.disconnect()
  }, 10000)

  it('allows starting a second mission after landing, without reconnecting', async () => {
    const link = new MockLink({ tickMs: 20, timeScale: 20, home: { lat: 0, lon: 0, altAmslM: 0 } })
    const states: VehicleState[] = []
    link.onState((s) => states.push(s))

    await link.connect('v1')
    await link.send({ type: 'arm' })
    await link.uploadMission(sampleMission())
    await link.send({ type: 'mission.start' })
    await waitFor(() => states.some((s) => s.armed && s.landed && s.vtolState === 'mc'), 8000)

    const secondStart = await link.send({ type: 'mission.start' })
    expect(secondStart).toEqual({ ok: true })

    await link.disconnect()
  }, 10000)
})
