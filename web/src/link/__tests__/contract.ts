import { describe, expect, it } from 'vitest'
import type { LinkStatus, Mission, VehicleState } from '../../domain'
import type { VehicleLink } from '../VehicleLink'

export interface VehicleLinkContractOptions {
  /** Creates a fresh, not-yet-connected link for each test. */
  createLink: () => VehicleLink
  /** A vehicle id this implementation accepts. Defaults to 'test-vehicle'. */
  vehicleId?: string
}

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
    id: 'contract-mission',
    name: 'contract test mission',
    items: [
      { type: 'vtolTakeoff', altM: 50 },
      { type: 'waypoint', lat: 1, lon: 2, altM: 50 },
      { type: 'vtolLand', lat: 1, lon: 2 },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/**
 * Every VehicleLink implementation (MockLink, WebRtcLink, ...) must pass
 * this suite. It only asserts behaviour the UI actually depends on — it
 * must not assume any implementation's internal simulation state.
 */
export function runVehicleLinkContractTests(name: string, opts: VehicleLinkContractOptions): void {
  const vehicleId = opts.vehicleId ?? 'test-vehicle'

  describe(`VehicleLink contract: ${name}`, () => {
    it('reaches a connected link status after connect()', async () => {
      const link = opts.createLink()
      const statuses: LinkStatus[] = []
      link.onLinkStatus((s) => statuses.push(s))

      await link.connect(vehicleId)
      await waitFor(() => statuses.some((s) => s.state === 'connected'))

      expect(statuses.some((s) => s.state === 'connected')).toBe(true)
      await link.disconnect()
    })

    it('reaches a disconnected link status after disconnect()', async () => {
      const link = opts.createLink()
      const statuses: LinkStatus[] = []
      link.onLinkStatus((s) => statuses.push(s))

      await link.connect(vehicleId)
      await waitFor(() => statuses.some((s) => s.state === 'connected'))
      await link.disconnect()

      expect(statuses[statuses.length - 1]?.state).toBe('disconnected')
    })

    it('emits vehicle state updates once connected', async () => {
      const link = opts.createLink()
      const states: VehicleState[] = []
      link.onState((s) => states.push(s))

      await link.connect(vehicleId)
      await waitFor(() => states.length > 0)

      expect(states.length).toBeGreaterThan(0)
      expect(typeof states[0]?.updatedAt).toBe('number')
      await link.disconnect()
    })

    it('stops calling a callback after it unsubscribes', async () => {
      const link = opts.createLink()
      let count = 0
      const unsubscribe = link.onState(() => {
        count++
      })

      await link.connect(vehicleId)
      await waitFor(() => count > 0)
      unsubscribe()
      const countAtUnsubscribe = count
      await delay(100)

      expect(count).toBe(countAtUnsubscribe)
      await link.disconnect()
    })

    it('rejects commands sent before connecting', async () => {
      const link = opts.createLink()
      const result = await link.send({ type: 'arm' })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe('not_connected')
    })

    it('returns a well-formed CommandResult once connected', async () => {
      const link = opts.createLink()
      await link.connect(vehicleId)

      const result = await link.send({ type: 'disarm' })
      expect(typeof result.ok).toBe('boolean')
      if (!result.ok) {
        expect([
          'rejected_by_vehicle',
          'blocked_rc_override',
          'preflight_failed',
          'timeout',
          'not_connected',
          'unauthorised',
        ]).toContain(result.reason)
      }

      await link.disconnect()
    })

    it('downloadMission returns null before any mission is uploaded', async () => {
      const link = opts.createLink()
      await link.connect(vehicleId)

      expect(await link.downloadMission()).toBeNull()

      await link.disconnect()
    })

    it('round-trips an uploaded mission', async () => {
      const link = opts.createLink()
      await link.connect(vehicleId)
      const mission = sampleMission()

      const result = await link.uploadMission(mission)
      expect(result.ok).toBe(true)

      const downloaded = await link.downloadMission()
      expect(downloaded).toEqual(mission)

      await link.disconnect()
    })

    it('exposes a video subscription that can be unsubscribed without throwing', async () => {
      const link = opts.createLink()
      const unsubscribe = link.onVideoStream(() => {})

      await link.connect(vehicleId)
      expect(() => unsubscribe()).not.toThrow()
      expect(link.getVideoStream() === null || typeof link.getVideoStream() === 'object').toBe(true)

      await link.disconnect()
    })
  })
}
