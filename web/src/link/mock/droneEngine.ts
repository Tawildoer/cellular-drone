import type {
  Command,
  CommandResult,
  FailsafeFlags,
  GpsStatus,
  HomePosition,
  Mission,
  MissionUploadResult,
  VehicleEvent,
  VehicleState,
  VideoPreset,
} from '../../domain'
import { validateMission } from '../../domain'
import { translateMission } from '../../ardupilot'
import {
  CRUISE_SPEED_MPS,
  deriveVtolState,
  initialSimState,
  isFlying,
  setPaused,
  startMission,
  startQland,
  startRtl,
  stepSim,
  type FlightPhysicsConfig,
  type SimState,
} from './sim'
import { CALM_WIND, DEFAULT_LOOK_AHEAD_M, DEFAULT_MAX_TURN_RATE_DEG_PER_S, type Wind } from './flightDynamics'

export interface FailsafeFaultConfig {
  gcs: boolean
  battery: boolean
  geofence: boolean
  rc: boolean
}

export interface FaultInjectionConfig {
  /** Added delay before command responses and before each telemetry sample, in ms. */
  latencyMs: number
  /** Probability (0..1) that a given telemetry sample is dropped, simulating the unreliable channel. */
  lossRate: number
  /** Hard link drop: no telemetry, commands fail as a timeout. */
  linkDropped: boolean
  /** The physical ELRS radio has taken control — browser mode changes must be refused (ADR-0008). */
  rcOverrideActive: boolean
  /** Forces the battery down near empty. */
  lowBattery: boolean
  /** Force specific failsafe flags active regardless of simulated vehicle state. */
  failsafe: FailsafeFaultConfig
  /** Blowing from `directionDeg` at `speedMps`, drifting the aircraft off its
   * commanded track — calm (zero) by default, an explicit opt-in fault. */
  wind: Wind
  /** Random heading jitter (deg/s), the aircraft's "wobble" — on by default
   * (unlike `stepSim`'s own calm/deterministic default) since this is the
   * actual simulated drone the UI flies against, not a unit-test fixture. */
  headingNoiseDegPerS: number
  /** Not really a "fault" — a guidance tuning knob (flightDynamics.ts's
   * lookAheadPoint) — but lives here anyway so dev tooling has one existing
   * get/set channel (setFaultConfig) to adjust the live simulated drone through. */
  lookAheadM: number
}

const DEFAULT_HEADING_NOISE_DEG_PER_S = 1.5

export function defaultFaultConfig(): FaultInjectionConfig {
  return {
    latencyMs: 0,
    lossRate: 0,
    linkDropped: false,
    rcOverrideActive: false,
    lowBattery: false,
    failsafe: { gcs: false, battery: false, geofence: false, rc: false },
    wind: CALM_WIND,
    headingNoiseDegPerS: DEFAULT_HEADING_NOISE_DEG_PER_S,
    lookAheadM: DEFAULT_LOOK_AHEAD_M,
  }
}

export interface DroneEngineOptions {
  home?: HomePosition
}

const LOW_BATTERY_THRESHOLD_PERCENT = 20
const FAILSAFE_KEYS = ['gcs', 'battery', 'geofence', 'rc'] as const
const DEFAULT_HOME: HomePosition = { lat: -37.861, lon: 145.062, altAmslM: 50 }

/**
 * The simulated VTOL state machine: physics (sim.ts) plus command validation
 * and failsafe/mode-change event derivation. Zero knowledge of transport,
 * protocol encoding, timers, or video — shared by MockLink (in-browser,
 * ADR-0009) and mock-agent (standalone process, ADR-0012) so both "appear as
 * a real drone" to the UI identically.
 */
export class DroneEngine {
  private sim: SimState
  private mission: Mission | null = null
  private fault: FaultInjectionConfig = defaultFaultConfig()
  private failsafeFlags: FailsafeFlags = { gcs: false, battery: false, geofence: false, rc: false }
  private lastFlightMode: VehicleState['flightMode'] = 'UNKNOWN'
  private videoPreset: VideoPreset = 'medium'
  private vehicleId = ''
  private connectedElapsedS = 0

  constructor(opts: DroneEngineOptions = {}) {
    this.sim = initialSimState(opts.home ?? DEFAULT_HOME)
  }

  connect(vehicleId: string): void {
    this.vehicleId = vehicleId
    this.connectedElapsedS = 0
  }

  getVideoPreset(): VideoPreset {
    return this.videoPreset
  }

  getFaultConfig(): FaultInjectionConfig {
    return this.fault
  }

  /** Returns the rcOverride event to emit, if the override state actually changed. */
  setFaultConfig(partial: Partial<FaultInjectionConfig>): VehicleEvent | null {
    const prevRcOverride = this.fault.rcOverrideActive
    this.fault = {
      ...this.fault,
      ...partial,
      failsafe: { ...this.fault.failsafe, ...partial.failsafe },
    }
    if (this.fault.rcOverrideActive !== prevRcOverride) {
      return { kind: 'rcOverride', active: this.fault.rcOverrideActive, ts: Date.now() }
    }
    return null
  }

  applyCommand(cmd: Command): CommandResult {
    if (cmd.type !== 'video.config' && this.fault.rcOverrideActive) {
      return { ok: false, reason: 'blocked_rc_override', detail: 'RC override is active' }
    }

    switch (cmd.type) {
      case 'arm': {
        if (this.sim.armed) return { ok: false, reason: 'rejected_by_vehicle', detail: 'already armed' }
        this.sim = { ...this.sim, armed: true }
        return { ok: true }
      }
      case 'disarm': {
        if (!this.sim.armed) return { ok: false, reason: 'rejected_by_vehicle', detail: 'already disarmed' }
        if (isFlying(this.sim.phase)) return { ok: false, reason: 'rejected_by_vehicle', detail: 'cannot disarm while flying' }
        this.sim = { ...this.sim, armed: false }
        return { ok: true }
      }
      case 'mission.start': {
        if (!this.sim.armed) return { ok: false, reason: 'preflight_failed', detail: 'not armed' }
        if (!this.mission) return { ok: false, reason: 'preflight_failed', detail: 'no mission loaded' }
        // 'landed' (as opposed to 'idle') is also a valid starting point —
        // otherwise a second mission could never be flown without
        // disconnecting and reconnecting first.
        if (isFlying(this.sim.phase)) return { ok: false, reason: 'rejected_by_vehicle', detail: 'already flying' }
        this.sim = startMission(this.sim, this.mission)
        return { ok: true }
      }
      case 'mode.pause': {
        if (!isFlying(this.sim.phase)) return { ok: false, reason: 'rejected_by_vehicle', detail: 'not flying' }
        this.sim = setPaused(this.sim, true)
        return { ok: true }
      }
      case 'mode.resume': {
        if (!this.sim.paused) return { ok: false, reason: 'rejected_by_vehicle', detail: 'not paused' }
        this.sim = setPaused(this.sim, false)
        return { ok: true }
      }
      case 'mode.rtl': {
        if (!isFlying(this.sim.phase)) return { ok: false, reason: 'rejected_by_vehicle', detail: 'not flying' }
        this.sim = startRtl(this.sim)
        return { ok: true }
      }
      case 'mode.qland': {
        if (!isFlying(this.sim.phase)) return { ok: false, reason: 'rejected_by_vehicle', detail: 'not flying' }
        this.sim = startQland(this.sim)
        return { ok: true }
      }
      case 'video.config': {
        this.videoPreset = cmd.preset
        return { ok: true }
      }
    }
  }

  /** On success, also returns the ArduPilot rows a real flight controller
   * would read back — the mock stands in for one (ADR-0017). */
  uploadMission(mission: Mission): MissionUploadResult {
    if (isFlying(this.sim.phase)) {
      return { ok: false, reason: 'rejected_by_vehicle', detail: 'cannot change the mission while flying' }
    }
    const validation = validateMission(mission)
    if (!validation.valid) {
      return { ok: false, reason: 'rejected_by_vehicle', detail: validation.issues.map((i) => i.message).join('; ') }
    }
    this.mission = mission
    return { ok: true, onVehicle: translateMission(mission, this.sim.home).items }
  }

  downloadMission(): Mission | null {
    return this.mission
  }

  /** Advances the simulation by dtS seconds; returns any events that fired. */
  tick(dtS: number): VehicleEvent[] {
    this.connectedElapsedS += dtS
    const physics: FlightPhysicsConfig = {
      maxTurnRateDegPerS: DEFAULT_MAX_TURN_RATE_DEG_PER_S,
      wind: this.fault.wind,
      headingNoiseDegPerS: this.fault.headingNoiseDegPerS,
      lookAheadM: this.fault.lookAheadM,
    }
    // Real wall clock, not sim time: a clock advanced by sim time runs ahead
    // whenever the sim is sped up and never catches back up, so a clock-mode
    // loiter would see its end time as long past and leave after one lap.
    this.sim = stepSim(this.sim, this.mission, dtS, physics, Date.now())
    if (this.fault.lowBattery) {
      this.sim = { ...this.sim, batteryPercent: Math.min(this.sim.batteryPercent, 15) }
    }

    const events = this.updateFailsafe()
    const modeEvent = this.updateFlightMode()
    if (modeEvent) events.push(modeEvent)
    return events
  }

  buildVehicleState(): VehicleState {
    const flying = isFlying(this.sim.phase)
    return {
      vehicleId: this.vehicleId,
      position: this.sim.position,
      attitude: { rollDeg: 0, pitchDeg: 0, yawDeg: this.sim.headingDeg },
      groundSpeedMps: this.sim.groundSpeedMps,
      // The commanded airspeed — distinct from groundSpeedMps once wind is
      // blowing, same distinction VehicleState has always had fields for.
      airspeedMps: this.sim.phase === 'cruise' || this.sim.phase === 'rtl' ? CRUISE_SPEED_MPS : 0,
      climbMps: 0,
      battery: {
        voltageV: 18 + (this.sim.batteryPercent / 100) * 7,
        currentA: flying ? 15 : 0.5,
        percent: this.sim.batteryPercent,
      },
      gps: this.gpsStatus(),
      flightMode: this.flightMode(),
      armed: this.sim.armed,
      vtolState: deriveVtolState(this.sim.phase),
      landed: this.sim.phase === 'idle' || this.sim.phase === 'landed',
      home: this.sim.home,
      missionProgress: { currentIndex: this.sim.missionIndex, total: this.mission?.items.length ?? 0 },
      // A takeover is the pilot moving the switch off AUTO (ADR-0008).
      rc: { linked: true, overrideActive: this.fault.rcOverrideActive, modeSwitch: this.fault.rcOverrideActive ? 'FBWA' : 'AUTO' },
      failsafe: this.failsafeFlags,
      updatedAt: Date.now(),
    }
  }

  private gpsStatus(): GpsStatus {
    if (this.connectedElapsedS < 1) return { fixType: 'none', satellites: 0, hdop: 99 }
    if (this.connectedElapsedS < 2) return { fixType: 'fix2d', satellites: 5, hdop: 3 }
    return { fixType: 'fix3d', satellites: 12, hdop: 0.8 }
  }

  private flightMode(): VehicleState['flightMode'] {
    switch (this.sim.phase) {
      case 'idle':
      case 'landed':
        return 'UNKNOWN'
      case 'rtl':
        return 'RTL'
      case 'qland':
        return 'QLAND'
      case 'takeoff':
      case 'transition':
      case 'cruise':
      case 'loiter':
        if (!this.sim.paused) return 'AUTO'
        return deriveVtolState(this.sim.phase) === 'mc' ? 'QLOITER' : 'LOITER'
    }
  }

  private updateFailsafe(): VehicleEvent[] {
    const next: FailsafeFlags = {
      gcs: this.fault.failsafe.gcs,
      battery: this.fault.failsafe.battery || this.sim.batteryPercent < LOW_BATTERY_THRESHOLD_PERCENT,
      geofence: this.fault.failsafe.geofence,
      rc: this.fault.failsafe.rc,
    }

    const events: VehicleEvent[] = []
    for (const flag of FAILSAFE_KEYS) {
      if (next[flag] !== this.failsafeFlags[flag]) {
        events.push({ kind: 'failsafe', flag, active: next[flag], ts: Date.now() })
      }
    }
    this.failsafeFlags = next
    return events
  }

  private updateFlightMode(): VehicleEvent | null {
    const mode = this.flightMode()
    if (mode !== this.lastFlightMode) {
      this.lastFlightMode = mode
      return { kind: 'modeChanged', mode, ts: Date.now() }
    }
    return null
  }
}
