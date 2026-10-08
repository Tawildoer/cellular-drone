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
  /** epoch ms */
  updatedAt: number
}

export type VehicleEvent =
  | { kind: 'status'; text: string; ts: number }
  | { kind: 'failsafe'; flag: keyof FailsafeFlags; active: boolean; ts: number }
  | { kind: 'modeChanged'; mode: FlightMode; ts: number }
  | { kind: 'rcOverride'; active: boolean; ts: number }
