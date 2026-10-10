import type {
  Command,
  CommandResult,
  FailsafeFlags,
  FreeFlyState,
  GimbalAttitude,
  GimbalTarget,
  GpsStatus,
  HomePosition,
  Mission,
  MissionItem,
  MissionUploadResult,
  VehicleEvent,
  VehicleState,
  VideoPreset,
} from '../../domain'
import {
  batteryNeededToReturnPct,
  bearingDeg,
  FREE_FLY_LOITER_RADIUS_M,
  GIMBAL_LOCK_RANGE_M,
  haversineDistanceM,
  returnHomeEstimate,
  updateDrainRate,
  validateMission,
} from '../../domain'
import { translateMission } from '../../ardupilot'
import {
  CRUISE_SPEED_MPS,
  deriveVtolState,
  initialSimState,
  isFlying,
  setPaused,
  startMission,
  startCircle,
  startQland,
  startRtl,
  stepSim,
  type FlightPhysicsConfig,
  type SimState,
} from './sim'
import { simulatedCellSignal } from './cellSignal'
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
/** The mock's gimbal holds one angle, looking ahead and down, until gimbal
 * control exists; 45° puts its ground point about one height ahead. */
const MOCK_GIMBAL_PITCH_DEG = -45
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
  private gimbalLock: GimbalTarget | null = null
  /** Free fly (ADR-0024): its height, and the uploaded mission it replaced
   * on the vehicle, put back when free fly ends. */
  private freeFly: { altM: number; planned: Mission | null } | null = null
  /** Battery return (ADR-0025): measured drain, and what getting home needs. */
  private drainPctPerS: number | null = null
  private lastBatteryPct: number | null = null
  private toHomePct: number | undefined = undefined
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
    // Camera only, so allowed while the RC pilot has control (ADR-0023).
    if (cmd.type === 'gimbal.lock') {
      const distanceM = haversineDistanceM(this.sim.position, cmd.target)
      if (distanceM > GIMBAL_LOCK_RANGE_M) {
        return { ok: false, reason: 'rejected_by_vehicle', detail: `target ${Math.round(distanceM)} m away, over ${GIMBAL_LOCK_RANGE_M} m` }
      }
      this.gimbalLock = cmd.target
      return { ok: true }
    }
    if (cmd.type === 'gimbal.release') {
      if (!this.gimbalLock) return { ok: false, reason: 'rejected_by_vehicle', detail: 'not locked' }
      this.gimbalLock = null
      return { ok: true }
    }
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
      case 'freefly.start': {
        if (this.freeFly) return { ok: false, reason: 'rejected_by_vehicle', detail: 'already in free fly' }
        const { phase } = this.sim
        if (!isFlying(phase)) return { ok: false, reason: 'rejected_by_vehicle', detail: 'free fly needs the drone airborne' }
        if (phase === 'takeoff' || phase === 'qland') {
          return { ok: false, reason: 'rejected_by_vehicle', detail: phase === 'takeoff' ? 'still taking off' : 'landing' }
        }
        this.freeFly = { altM: cmd.altM, planned: this.mission }
        const now = Date.now()
        this.mission = { id: 'free-fly', name: 'Free fly', items: [], createdAt: now, updatedAt: now }
        const here = { lat: this.sim.position.lat, lon: this.sim.position.lon }
        this.sim = { ...startCircle(this.sim, here, cmd.altM, FREE_FLY_LOITER_RADIUS_M), paused: false, missionIndex: 0, circleAtEnd: true }
        return { ok: true }
      }
      case 'freefly.waypoint': {
        if (!this.freeFly || !this.mission) return { ok: false, reason: 'rejected_by_vehicle', detail: 'not in free fly' }
        const point = { lat: cmd.lat, lon: cmd.lon }
        const wasCircling = this.circlingAtEnd()
        const items = [...this.mission.items, { type: 'waypoint' as const, ...point, altM: this.freeFly.altM }]
        this.mission = { ...this.mission, items, updatedAt: Date.now() }
        if (items.length === 1) {
          // The first: straight off the circle free fly started on.
          const here = { lat: this.sim.position.lat, lon: this.sim.position.lon }
          this.sim = {
            ...this.sim,
            phase: 'cruise',
            missionIndex: 0,
            target: point,
            legStart: here,
            targetAltM: this.freeFly.altM,
            legStartAltM: this.sim.position.altRelM,
            loiterCenter: null,
            extending: false,
          }
        } else if (wasCircling && this.mission.items[this.sim.missionIndex]?.type !== 'loiter') {
          // Waiting circle over a plain waypoint: leave it as soon as it's
          // heading the right way. (A loiter waypoint finishes its lap first.)
          this.sim = { ...this.sim, loiterTargetDeg: this.sim.loiterSweptDeg }
        }
        return { ok: true }
      }
      case 'freefly.remove': {
        const refused = this.checkFreeFlyEdit(cmd.index, cmd.at)
        if (refused) return refused
        const mission = this.mission!
        if (cmd.index === this.sim.missionIndex && this.circlingAtEnd()) {
          return { ok: false, reason: 'rejected_by_vehicle', detail: 'it is circling there' }
        }
        const items = mission.items.filter((_, i) => i !== cmd.index)
        this.mission = { ...mission, items, updatedAt: Date.now() }
        if (cmd.index > this.sim.missionIndex) return { ok: true }
        // The one being flown to: on to the next, or circle here if none.
        const here = { lat: this.sim.position.lat, lon: this.sim.position.lon }
        const next = items[cmd.index]
        if (next && next.type !== 'vtolTakeoff' && next.type !== 'returnToLaunch') {
          const phase = this.sim.phase === 'loiter' ? 'cruise' : this.sim.phase
          const altM = next.type === 'vtolLand' ? 0 : next.altM
          this.sim = {
            ...this.sim,
            phase,
            target: { lat: next.lat, lon: next.lon },
            legStart: here,
            targetAltM: altM,
            legStartAltM: this.sim.position.altRelM,
            extending: false,
            loiterCenter: null,
          }
        } else {
          this.sim = { ...startCircle(this.sim, here, this.freeFly!.altM, FREE_FLY_LOITER_RADIUS_M), missionIndex: Math.max(0, items.length - 1) }
        }
        return { ok: true }
      }
      case 'freefly.loiter': {
        const refused = this.checkFreeFlyEdit(cmd.index, cmd.at)
        if (refused) return refused
        const mission = this.mission!
        const item = mission.items[cmd.index] as Extract<MissionItem, { type: 'waypoint' | 'loiter' }>
        const point = { lat: item.lat, lon: item.lon }
        const replaced: MissionItem = cmd.loiter
          ? { type: 'loiter', ...point, altM: item.altM, radiusM: FREE_FLY_LOITER_RADIUS_M, turns: 1 }
          : { type: 'waypoint', ...point, altM: item.altM }
        this.mission = { ...mission, items: mission.items.map((it, i) => (i === cmd.index ? replaced : it)), updatedAt: Date.now() }
        // Circling it mid-route as it becomes a waypoint: done with its lap,
        // on to the next. (At the end of the route it circles either way.)
        if (cmd.index === this.sim.missionIndex && !cmd.loiter && this.sim.phase === 'loiter') {
          this.sim = { ...this.sim, loiterTargetDeg: 0, loiterUntilMs: null }
        }
        return { ok: true }
      }
      case 'mode.rtl': {
        if (!isFlying(this.sim.phase)) return { ok: false, reason: 'rejected_by_vehicle', detail: 'not flying' }
        this.sim = startRtl(this.sim)
        this.endFreeFly()
        return { ok: true }
      }
      case 'mode.qland': {
        if (!isFlying(this.sim.phase)) return { ok: false, reason: 'rejected_by_vehicle', detail: 'not flying' }
        this.sim = startQland(this.sim)
        this.endFreeFly()
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
    if (this.freeFly && !isFlying(this.sim.phase)) this.endFreeFly()
    if (this.fault.lowBattery) {
      this.sim = { ...this.sim, batteryPercent: Math.min(this.sim.batteryPercent, 15) }
    }
    const batteryEvent = this.updateBatteryReturn(dtS)

    const events = this.updateFailsafe()
    const gimbalEvent = this.updateGimbalLock()
    if (gimbalEvent) events.push(gimbalEvent)
    if (batteryEvent) events.push(batteryEvent)
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
        toHomePercent: this.toHomePct,
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
      gimbal: this.gimbalAttitude(),
      freeFly: this.freeFlyState(),
      // The mock's simulated wind, when one is set: what ArduPilot's own
      // estimate would report. Calm (the default) reports nothing, so the
      // console falls back to the forecast.
      wind: this.fault.wind.speedMps > 0 ? { speedMps: this.fault.wind.speedMps, fromDeg: this.fault.wind.directionDeg } : undefined,
      // What the agent will read from the LTE modem: towers round home.
      cellular: simulatedCellSignal(this.sim.home, this.sim.position, this.sim.position.altRelM),
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

  /**
   * Battery return (ADR-0025): while flying, what getting home and landing
   * would take at the drain measured so far; once the battery is down to
   * that, RTL, from wherever it is and whatever it was doing (a mission,
   * free fly, a pause). Not while it's already returning or landing, nor
   * while the RC pilot has control: their call.
   */
  private updateBatteryReturn(dtS: number): VehicleEvent | null {
    const { phase, batteryPercent, position, home } = this.sim
    if (this.lastBatteryPct !== null && isFlying(phase)) {
      this.drainPctPerS = updateDrainRate(this.drainPctPerS, this.lastBatteryPct, batteryPercent, dtS)
    }
    this.lastBatteryPct = batteryPercent
    if (!isFlying(phase) || phase === 'takeoff' || this.drainPctPerS === null) {
      this.toHomePct = undefined
      return null
    }
    const aircraft = { point: position, altM: position.altRelM, fixedWing: deriveVtolState(phase) === 'fw' }
    const wind = { speedMps: this.fault.wind.speedMps, fromDeg: this.fault.wind.directionDeg }
    this.toHomePct = batteryNeededToReturnPct(returnHomeEstimate(aircraft, home, undefined, wind).durationS, this.drainPctPerS)
    if (phase === 'rtl' || phase === 'qland' || this.fault.rcOverrideActive || batteryPercent > this.toHomePct) return null
    this.sim = startRtl(setPaused(this.sim, false))
    this.endFreeFly()
    return {
      kind: 'status',
      text: `Battery: returning home (${Math.round(batteryPercent)}% left, about ${Math.round(this.toHomePct)}% needed to get home and land)`,
      ts: Date.now(),
    }
  }

  /** Releases the lock once the aircraft is out of range; it stays released
   * if the aircraft comes back (ADR-0023). */
  private updateGimbalLock(): VehicleEvent | null {
    if (!this.gimbalLock || haversineDistanceM(this.sim.position, this.gimbalLock) <= GIMBAL_LOCK_RANGE_M) return null
    this.gimbalLock = null
    return { kind: 'status', text: `Gimbal lock released: target over ${GIMBAL_LOCK_RANGE_M} m away`, ts: Date.now() }
  }

  /** Pointed at a spot from wherever the aircraft is, anywhere in the
   * hemisphere below it: the operator's lock, else a loiter's centre.
   * Otherwise the default look ahead and down. */
  private gimbalAttitude(): GimbalAttitude {
    const lock = this.gimbalLock ?? undefined
    // Circling a loiter, it watches the centre; the operator's lock wins.
    const { loiterCenter, phase, home } = this.sim
    const loiterTarget = phase === 'loiter' && loiterCenter ? { ...loiterCenter, altAmslM: home.altAmslM } : undefined
    const target = lock ?? loiterTarget
    if (!target) return { pitchDeg: MOCK_GIMBAL_PITCH_DEG, yawDeg: 0 }
    const { position, headingDeg } = this.sim
    // The mock's altAmslM doesn't follow its climb; build it from home.
    const heightAboveM = home.altAmslM + position.altRelM - target.altAmslM
    const distanceM = haversineDistanceM(position, target)
    const pitchDeg = Math.max(-90, Math.min(0, (-Math.atan2(heightAboveM, distanceM) * 180) / Math.PI))
    const yawDeg = distanceM < 0.5 ? 0 : ((((bearingDeg(position, target) - headingDeg) % 360) + 540) % 360) - 180
    return { pitchDeg, yawDeg, lock, lookAt: target }
  }

  private freeFlyState(): FreeFlyState | undefined {
    if (!this.freeFly || !this.mission) return undefined
    const waypoints = this.mission.items.flatMap((item) =>
      item.type === 'waypoint'
        ? [{ lat: item.lat, lon: item.lon }]
        : item.type === 'loiter'
          ? [{ lat: item.lat, lon: item.lon, loiterRadiusM: item.radiusM }]
          : [],
    )
    return { altM: this.freeFly.altM, waypoints, circling: this.circlingAtEnd() }
  }

  /** Circling at the end of the free-fly route, waiting for a waypoint. */
  private circlingAtEnd(): boolean {
    return !!this.freeFly && this.sim.phase === 'loiter' && this.sim.circleAtEnd && !this.mission?.items[this.sim.missionIndex + 1]
  }

  /** Why a free-fly waypoint can't be edited, or null if it can: not in free
   * fly, the route has changed under the browser, or it's already flown. */
  private checkFreeFlyEdit(index: number, at: { lat: number; lon: number }): CommandResult | null {
    if (!this.freeFly || !this.mission) return { ok: false, reason: 'rejected_by_vehicle', detail: 'not in free fly' }
    const item = this.mission.items[index]
    if (!item || (item.type !== 'waypoint' && item.type !== 'loiter') || haversineDistanceM(item, at) > 1) {
      return { ok: false, reason: 'rejected_by_vehicle', detail: 'the route has changed, try again' }
    }
    if (index < this.sim.missionIndex) return { ok: false, reason: 'rejected_by_vehicle', detail: 'already flown' }
    return null
  }

  /** Back to the planned mission (the agent re-uploads it on a real FC). */
  private endFreeFly(): void {
    if (!this.freeFly) return
    this.mission = this.freeFly.planned
    this.freeFly = null
    this.sim = { ...this.sim, circleAtEnd: false, missionIndex: 0 }
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
