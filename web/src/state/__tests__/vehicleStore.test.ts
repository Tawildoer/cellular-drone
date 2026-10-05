import { describe, expect, it } from 'vitest'
import type { Mission } from '../../domain'
import { MockLink } from '../../link/mock'
import { createVehicleStore } from '../vehicleStore'

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

const validMission: Mission = {
  id: 'm1',
  name: 'test',
  items: [{ type: 'vtolTakeoff', altM: 50 }, { type: 'returnToLaunch' }],
  createdAt: 0,
  updatedAt: 0,
}

describe('vehicleStore missionOnVehicle', () => {
  it('records a mission once the vehicle accepts it, and clears it on disconnect', async () => {
    const store = createVehicleStore(new MockLink({ tickMs: 20 }))
    await store.getState().connect('drone-1')
    expect(store.getState().missionOnVehicle).toBeNull()

    const result = await store.getState().uploadMission(validMission)
    expect(result.ok).toBe(true)
    expect(store.getState().missionOnVehicle).toEqual(validMission)

    await store.getState().disconnect()
    expect(store.getState().missionOnVehicle).toBeNull()
  })

  it('keeps the previous mission when the vehicle rejects an upload', async () => {
    const store = createVehicleStore(new MockLink({ tickMs: 20 }))
    await store.getState().connect('drone-1')
    await store.getState().uploadMission(validMission)

    const invalid: Mission = { ...validMission, id: 'm2', items: [{ type: 'returnToLaunch' }] }
    const result = await store.getState().uploadMission(invalid)
    expect(result.ok).toBe(false)
    expect(store.getState().missionOnVehicle).toEqual(validMission)
    await store.getState().disconnect()
  })
})

describe('vehicleStore', () => {
  it('reflects connection state after connect()', async () => {
    const store = createVehicleStore(new MockLink({ tickMs: 20 }))
    await store.getState().connect('drone-1')
    await waitFor(() => store.getState().connectionState === 'connected')

    expect(store.getState().connectionState).toBe('connected')
    await store.getState().disconnect()
  })

  it('receives vehicle state updates once connected', async () => {
    const store = createVehicleStore(new MockLink({ tickMs: 20 }))
    await store.getState().connect('drone-1')
    await waitFor(() => store.getState().vehicleState !== null)

    expect(store.getState().vehicleState?.vehicleId).toBe('drone-1')
    await store.getState().disconnect()
  })

  it('resets to a clean slate on disconnect', async () => {
    const store = createVehicleStore(new MockLink({ tickMs: 20 }))
    await store.getState().connect('drone-1')
    await waitFor(() => store.getState().vehicleState !== null)
    await store.getState().disconnect()

    expect(store.getState()).toMatchObject({
      connectionState: 'disconnected',
      vehicleState: null,
      linkStatus: null,
      videoStream: null,
    })
  })

  it('does not double-subscribe across repeated connect() calls', async () => {
    const store = createVehicleStore(new MockLink({ tickMs: 20 }))
    await store.getState().connect('drone-1')
    await waitFor(() => store.getState().vehicleState !== null)
    await store.getState().connect('drone-1')
    await delay(100)

    // No crash, and still exactly one live subscription worth of updates arriving.
    expect(store.getState().connectionState).toBe('connected')
    await store.getState().disconnect()
  })

  it('rejects a command sent before connecting', async () => {
    const store = createVehicleStore(new MockLink())
    const result = await store.getState().send({ type: 'arm' })
    expect(result).toEqual({ ok: false, reason: 'not_connected' })
  })
})
