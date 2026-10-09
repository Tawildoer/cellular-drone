import { createStore } from 'zustand/vanilla'
import type { FlightRecord } from '../domain'
import type { FlightLogRepository } from '../services'

export interface FlightLogStoreState {
  /** Newest first. */
  records: FlightRecord[]
  refresh(): Promise<void>
  add(record: FlightRecord): Promise<void>
  clear(): Promise<void>
}

export function createFlightLogStore(repo: FlightLogRepository) {
  return createStore<FlightLogStoreState>((set) => ({
    records: [],
    async refresh() {
      set({ records: await repo.list() })
    },
    async add(record) {
      await repo.add(record)
      set({ records: await repo.list() })
    },
    async clear() {
      await repo.clear()
      set({ records: [] })
    },
  }))
}

export type FlightLogStore = ReturnType<typeof createFlightLogStore>
