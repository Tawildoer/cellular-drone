import type { CommandResult } from './command'

/**
 * One row of the mission as the flight controller stores it — what a
 * readback returns. Deliberately raw: `command` and `frame` are the flight
 * stack's own numbers (ArduPilot / MAVLink, see docs/MAVLINK.md), and only
 * the `MissionTranslator` service interprets them. UI code passes these
 * around and hands them to the translator; it never reads the numbers.
 */
export interface VehicleMissionItem {
  /** Position in the flight controller's list. 0 is home on ArduPilot. */
  seq: number
  command: number
  frame: number
  params: [number, number, number, number]
  lat: number
  lon: number
  altM: number
  /** The app `MissionItem` this row came from, or null (home, rows the
   * agent adds, or rows someone else wrote). */
  appIndex: number | null
}

/** `uploadMission`'s result. On success the vehicle may include what its
 * flight controller now holds, read back after the upload (ADR-0017): the
 * mission it will actually fly, as opposed to the planner's preview. */
export type MissionUploadResult = CommandResult & { onVehicle?: VehicleMissionItem[] }
