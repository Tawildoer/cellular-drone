import type { HomePosition, Mission, VehicleMissionItem } from '../domain'

/** One flight-controller row, already put into words for display. */
export interface FlightControllerRow {
  seq: number
  /** The app item it came from, or null (home, added rows). */
  appIndex: number | null
  command: string
  detail: string
}

export interface MissionTranslationIssue {
  itemIndex: number | null
  /** `error`: the flight controller would fly something other than the plan. */
  severity: 'error' | 'warning' | 'info'
  message: string
}

export interface MissionTranslationPreview {
  rows: FlightControllerRow[]
  /** Raw rows, to compare with what the vehicle reads back. */
  raw: VehicleMissionItem[]
  fenceVertexCount: number
  /** Parameters set alongside the upload, e.g. a fence ceiling. */
  params: Record<string, number>
  issues: MissionTranslationIssue[]
}

export interface MissionExportFile {
  filename: string
  mimeType: string
  text: string
}

/**
 * How a mission looks to the vehicle's flight stack (ADR-0017). The planner
 * uses this to preview and export; the drone agent does the real
 * translation on upload. UI code only sees this interface, never MAVLink.
 */
export interface MissionTranslator {
  /** For labels, e.g. "ArduPilot". */
  readonly flightStack: string
  preview(mission: Mission, home: HomePosition | null): MissionTranslationPreview
  /** Puts raw rows (e.g. a readback) into words. */
  describe(items: VehicleMissionItem[]): FlightControllerRow[]
  /** Whether two row lists mean the same mission, allowing for storage
   * rounding and home moving on arming. */
  matches(a: VehicleMissionItem[], b: VehicleMissionItem[]): boolean
  /** A file the flight stack's own ground-station tools can load. */
  exportFile(mission: Mission, home: HomePosition | null): MissionExportFile
}
