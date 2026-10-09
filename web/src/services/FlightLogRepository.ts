import type { FlightRecord } from '../domain'

/** Where finished flights are kept for the flight log. Newest first. */
export interface FlightLogRepository {
  list(): Promise<FlightRecord[]>
  add(record: FlightRecord): Promise<void>
  clear(): Promise<void>
}
