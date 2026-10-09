import type { FlightRecord } from '../../domain'
import type { FlightLogRepository } from '../FlightLogRepository'

/** Keeps flights in memory only: tests, and anywhere storage isn't wanted. */
export class InMemoryFlightLogRepository implements FlightLogRepository {
  private records: FlightRecord[] = []

  async list(): Promise<FlightRecord[]> {
    return [...this.records]
  }

  async add(record: FlightRecord): Promise<void> {
    this.records = [record, ...this.records]
  }

  async clear(): Promise<void> {
    this.records = []
  }
}
