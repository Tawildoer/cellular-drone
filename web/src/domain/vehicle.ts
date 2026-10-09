import type { WindVector } from './weather'

/** The app's own vocabulary for vehicle state. Stable even if the flight stack or transport changes. */

/** An entry in the vehicle-selection list. */
export interface VehicleDescriptor {
  id: string
  name: string
  /** A simulated drone backed by the in-browser sim, not real hardware. */
  demo?: boolean
}

export type FlightMode =
  | 'AUTO'
  | 'LOITER'
  | 'QLOITER'
  | 'RTL'
  | 'QLAND'
  | 'QHOVER'
  | 'FBWA'
  | 'MANUAL'
  | 'UNKNOWN'

export type VtolState = 'mc' | 'fw' | 'transition'

export type GpsFixType = 'none' | 'fix2d' | 'fix3d' | 'rtk'

export interface Position {
  lat: number
  lon: number
  altRelM: number
  altAmslM: number
}

export interface Attitude {
  rollDeg: number
  pitchDeg: number
  yawDeg: number
}

export interface Battery {
  voltageV: number
  currentA: number
  percent: number
  /** What the vehicle estimates it needs to fly home and land from here,
   * reserve included; it returns home by itself at this (ADR-0025). Absent
   * on the ground, or before it can tell. */
  toHomePercent?: number
}

export interface GpsStatus {
  fixType: GpsFixType
  satellites: number
  hdop: number
}

export interface MissionProgress {
  currentIndex: number
  total: number
}

export interface RcStatus {
  linked: boolean
  overrideActive: boolean
  /** The mode the radio's mode switch selects; absent when unknown (no RC
   * link, or the vehicle doesn't report it). Missions start only with it at
   * AUTO, and moving it off AUTO is a takeover (ADR-0008). */
  modeSwitch?: FlightMode
}

export interface FailsafeFlags {
  gcs: boolean
  battery: boolean
  geofence: boolean
  rc: boolean
}

/** Where the gimbal camera points (ADR-0018: a 2-axis gimbal under the
 * airframe). Pitch is from the horizon, negative looking down (-90 is
 * straight down). Yaw is from the nose, clockwise. It can point anywhere in
 * the hemisphere under the aircraft (ADR-0023). */
export interface GimbalAttitude {
  pitchDeg: number
  yawDeg: number
  /** Set while the operator has locked the gimbal onto a spot (ADR-0023). */
  lock?: GimbalTarget
  /** The spot on the ground the gimbal is being pointed at, whatever the
   * reason: the operator's lock, or the centre of a loiter being circled.
   * Absent while it just looks ahead. */
  lookAt?: GimbalTarget
}

/** A spot on the ground for the gimbal to look at, with the ground's height
 * there (MAVLink's region of interest takes an altitude). */
export interface GimbalTarget {
  lat: number
  lon: number
  altAmslM: number
}

/** Free fly (ADR-0024): a rolling mission the operator adds waypoints to
 * from the map, flown at one height, circling the last one when the
 * route runs out. `waypoints` is the whole route, flown and to come;
 * missionProgress counts along it. */
export interface FreeFlyState {
  altM: number
  /** `loiterRadiusM` set: circled rather than flown through. */
  waypoints: { lat: number; lon: number; loiterRadiusM?: number }[]
  /** Circling the last waypoint (or where free fly started), waiting for
   * another. */
  circling: boolean
}

export interface HomePosition {
  lat: number
  lon: number
  altAmslM: number
}

export interface VehicleState {
  /** Stable per-vehicle identifier, carried through so any future live-position
   * export (e.g. a God's Eye View-style feed) can label the contact. */
  vehicleId: string
  position: Position
  attitude: Attitude
  groundSpeedMps: number
  airspeedMps: number
  climbMps: number
  battery: Battery
  gps: GpsStatus
  flightMode: FlightMode
  armed: boolean
  vtolState: VtolState
  landed: boolean
  home: HomePosition | null
  missionProgress: MissionProgress
  rc: RcStatus
  failsafe: FailsafeFlags
  /** Absent when no gimbal reports its attitude. */
  gimbal?: GimbalAttitude
  /** Present while in free fly (ADR-0024). */
  freeFly?: FreeFlyState
  /** The aircraft's own wind estimate (ArduPilot's `WIND`), measured where
   * it is; absent when it doesn't report one (ADR-0026). */
  wind?: WindVector
  /** epoch ms */
  updatedAt: number
}

export type VehicleEvent =
  | { kind: 'status'; text: string; ts: number }
  | { kind: 'failsafe'; flag: keyof FailsafeFlags; active: boolean; ts: number }
  | { kind: 'modeChanged'; mode: FlightMode; ts: number }
  | { kind: 'rcOverride'; active: boolean; ts: number }
