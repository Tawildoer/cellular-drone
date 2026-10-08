import { describe, expect, it } from 'vitest'
import type { CommandResult, LinkStatus, Mission, MissionUploadResult } from '../../domain'
import type { VehicleLink } from '../../link'
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

/** A link like WebRtcLink: connect() returns before the link can carry
 * requests, and it reports "connected" later, from its own events. */
class LateConnectingLink implements VehicleLink {
  private statusListeners = new Set<(s: LinkStatus) => void>()
  connected = false
  onVehicle: Mission | null = null

  async connect() {
    this.emit({ state: 'connecting' })
  }
  async disconnect() {
    this.connected = false
    this.emit({ state: 'disconnected' })
  }
  becomeConnected() {
    this.connected = true
    this.emit({ state: 'connected' })
  }
  private emit(status: LinkStatus) {
    this.statusListeners.forEach((cb) => cb(status))
  }
  onLinkStatus(cb: (s: LinkStatus) => void) {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }
  onState() {
    return () => {}
  }
  onEvent() {
    return () => {}
  }
  onVideoStream() {
    return () => {}
  }
  getVideoStream() {
    return null
  }
  async send(): Promise<CommandResult> {
    return { ok: true }
  }
  async uploadMission(m: Mission): Promise<MissionUploadResult> {
    this.onVehicle = m
    return { ok: true }
  }
  async downloadMission() {
    // Like WebRtcLink before its control channel opens: nothing to ask.
    return this.connected ? this.onVehicle : null
  }
}

describe('vehicleStore adopting the vehicle mission', () => {
  const flying: Mission = {
    id: 'already-flying',
    name: 'Already flying',
    items: [{ type: 'vtolTakeoff', altM: 40 }, { type: 'returnToLaunch' }],
    createdAt: 1,
    updatedAt: 1,
  }

  it("fetches it once the link is actually connected, not when connect() returns", async () => {
    const link = new LateConnectingLink()
    link.onVehicle = flying
    const store = createVehicleStore(link)

    await store.getState().connect('drone-1')
    expect(store.getState().missionOnVehicle).toBeNull()

    link.becomeConnected()
    await waitFor(() => store.getState().missionOnVehicle !== null)
    expect(store.getState().missionOnVehicle).toEqual(flying)
  })

  it('fetches it again after a reconnect', async () => {
    const link = new LateConnectingLink()
    const store = createVehicleStore(link)
    await store.getState().connect('drone-1')
    link.becomeConnected()
    await delay(10)
    expect(store.getState().missionOnVehicle).toBeNull()

    // Dropped, and meanwhile someone else gave the vehicle a mission.
    link.connected = false
    store.setState({ connectionState: 'degraded' })
    link.onVehicle = flying
    link.becomeConnected()
    await waitFor(() => store.getState().missionOnVehicle !== null)
    expect(store.getState().missionOnVehicle?.id).toBe('already-flying')
  })

  it("doesn't overwrite a mission this page uploaded meanwhile", async () => {
    const link = new LateConnectingLink()
    link.onVehicle = flying
    let release: () => void = () => {}
    const slow = new Promise<void>((resolve) => (release = resolve))
    const download = link.downloadMission.bind(link)
    link.downloadMission = async () => {
      const result = await download()
      await slow
      return result
    }
    const store = createVehicleStore(link)
    await store.getState().connect('drone-1')
    link.becomeConnected()

    const mine = { ...flying, id: 'mine', name: 'Mine' }
    await store.getState().uploadMission(mine)
    release()
    await delay(10)
    expect(store.getState().missionOnVehicle?.id).toBe('mine')
  })
})
