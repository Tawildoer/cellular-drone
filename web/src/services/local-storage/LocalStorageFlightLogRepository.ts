import type { FlightRecord } from '../../domain'
import type { FlightLogRepository } from '../FlightLogRepository'

export interface LocalStorageFlightLogRepositoryOptions {
  storageKey?: string
  storage?: Storage
  /** Oldest flights drop off past this many. */
  maxRecords?: number
}

const DEFAULT_STORAGE_KEY = 'cellular-drone:flight-log'
const DEFAULT_MAX_RECORDS = 100

/** This browser's flight log. The drone keeps its own, fuller one (the
 * agent's flight log); this is what the operator saw, for quick review. */
export class LocalStorageFlightLogRepository implements FlightLogRepository {
  private readonly storageKey: string
  private readonly storage: Storage
  private readonly maxRecords: number

  constructor(opts: LocalStorageFlightLogRepositoryOptions = {}) {
    this.storageKey = opts.storageKey ?? DEFAULT_STORAGE_KEY
    this.storage = opts.storage ?? globalThis.localStorage
    this.maxRecords = opts.maxRecords ?? DEFAULT_MAX_RECORDS
  }

  async list(): Promise<FlightRecord[]> {
    return this.read()
  }

  async add(record: FlightRecord): Promise<void> {
    this.storage.setItem(this.storageKey, JSON.stringify([record, ...this.read()].slice(0, this.maxRecords)))
  }

  async clear(): Promise<void> {
    this.storage.removeItem(this.storageKey)
  }

  private read(): FlightRecord[] {
    const raw = this.storage.getItem(this.storageKey)
    if (!raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as FlightRecord[]) : []
    } catch {
      return []
    }
  }
}
