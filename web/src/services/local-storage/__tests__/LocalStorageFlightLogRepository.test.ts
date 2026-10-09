import { describe, expect, it } from 'vitest'
import type { FlightRecord } from '../../../domain'
import { LocalStorageFlightLogRepository } from '../LocalStorageFlightLogRepository'

const flight = (id: string): FlightRecord => ({
  id,
  vehicleId: 'v',
  missionId: null,
  missionName: null,
  startedAt: 0,
  endedAt: 1,
  distanceM: 0,
  maxAltM: 0,
  furthestItem: 0,
  totalItems: 0,
  batteryStartPct: 100,
  batteryEndPct: 90,
  outcome: 'other',
})

describe('LocalStorageFlightLogRepository', () => {
  it('keeps flights newest first, capped, and clears', async () => {
    const repo = new LocalStorageFlightLogRepository({ storageKey: `test:flight-log-${Math.random()}`, maxRecords: 2 })
    await repo.add(flight('a'))
    await repo.add(flight('b'))
    await repo.add(flight('c'))
    expect((await repo.list()).map((f) => f.id)).toEqual(['c', 'b'])
    await repo.clear()
    expect(await repo.list()).toEqual([])
  })
})
