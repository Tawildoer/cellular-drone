import { bearingDeg, fromLocalEastNorthM, haversineDistanceM } from '../../domain/geo'
import { itemPosition, resolveLoiterUntilMs, type GeoPoint, type Mission } from '../../domain/mission'
import type { HomePosition, Position, VtolState } from '../../domain/vehicle'
import {
  angleDiffDeg,
  applyHeadingNoise,
  groundVelocityMps,
  lookAheadPoint,
  stepPosition,
  stepToward1D,
  turnToward,
  CALM_WIND,
  DEFAULT_ACCEPT_RADIUS_M,
  DEFAULT_LOOK_AHEAD_M,
  DEFAULT_MAX_TURN_RATE_DEG_PER_S,
  type Wind,
} from './flightDynamics'

export interface FlightPhysicsConfig {
  maxTurnRateDegPerS: number
  wind: Wind
  /** Random heading jitter (deg/s) — the "wobble". Zero = perfectly smooth/deterministic. */
  headingNoiseDegPerS: number
  /** How far ahead along the prescribed leg (legStart -> target) the aircraft
   * aims, instead of straight at the final waypoint — see flightDynamics.ts's
   * lookAheadPoint. This is what pulls it back onto the planned line after a
   * turn, rather than cutting a new straight line from wherever it ended up. */
  lookAheadM: number
  /** Overridable for deterministic tests; defaults to Math.random. */
  rng?: () => number
}

/** Calm and noise-free — the deterministic baseline `stepSim` uses unless the
 * caller opts into realism (see `droneEngine.ts`, which turns on noise by
 * default for the live app while leaving wind as an explicit opt-in fault). */
export function defaultFlightPhysicsConfig(): FlightPhysicsConfig {
  return {
    maxTurnRateDegPerS: DEFAULT_MAX_TURN_RATE_DEG_PER_S,
    wind: CALM_WIND,
    headingNoiseDegPerS: 0,
    lookAheadM: DEFAULT_LOOK_AHEAD_M,
  }
}

export type SimPhase = 'idle' | 'takeoff' | 'transition' | 'cruise' | 'loiter' | 'rtl' | 'qland' | 'landed'

export interface SimState {
  phase: SimPhase
  paused: boolean
  armed: boolean
  position: Position
  home: HomePosition
  target: GeoPoint | null
  /** Start of the straight line (legStart -> target) the aircraft is meant
   * to be tracking — the previous waypoint (or home/current position for the
   * first/RTL legs), used for look-ahead path following (flightDynamics.ts). */
  legStart: GeoPoint | null
  /** Altitude the aircraft climbs/descends toward over the current cruise
   * leg (a waypoint/loiter's own altM, or 0 for vtolLand) — null during RTL,
   * which keeps whatever altitude it had rather than targeting one. Used to
   * fold altitude into the "cleared" check so a waypoint only counts as
   * reached once the aircraft is genuinely close in 3D, not just overhead. */
  targetAltM: number | null
  headingDeg: number
  groundSpeedMps: number
  batteryPercent: number
  missionIndex: number
  phaseTimerS: number
  /** Latched "target is inside my turning circle, fly straight to open up
   * room before turning back" — see stepToward. Reset at the start of each leg. */
  extending: boolean
  /** Center of the circle being orbited during the 'loiter' phase — null
   * whenever not loitering. */
  loiterCenter: GeoPoint | null
  loiterRadiusM: number
  /** Degrees actually flown around the center while on the circle, compared
   * against loiterTargetDeg to know when at least one full lap is complete. */
  loiterSweptDeg: number
  loiterTargetDeg: number
  /** Clock mode: when lapping may stop (sim clock, epoch ms) — null in laps mode. */
  loiterUntilMs: number | null
  takeoffAltM: number
  /** The drone's clock (epoch ms) — the real wall clock on the live drone,
   * like a real one's GPS time; see stepSim. */
  clockMs: number
}

export const CRUISE_SPEED_MPS = 18
export const TAKEOFF_CLIMB_MPS = 3
export const LAND_DESCENT_MPS = 1.5
export const CRUISE_VERTICAL_RATE_MPS = 3
export const TRANSITION_DURATION_S = 5
/** How close the loiter's heading must be to the next leg's bearing before
 * exiting — see the 'loiter' case in stepSim. */
const LOITER_EXIT_ALIGNMENT_TOLERANCE_DEG = 30
/** This far outside the circle, the aircraft leaves the line to the loiter's
 * center and steers for the tangent point instead, so it arrives already
 * flying along the lap rather than having to turn hard onto it. */
const LOITER_TANGENT_ENTRY_M = 100
/** Distance scale of the circle-convergence term: how sharply the aircraft
 * steers back toward the circle per metre off it. */
const LOITER_CONVERGE_M = 50
/** Only progress made this close to the circle counts toward the lap. */
const LOITER_ON_CIRCLE_TOLERANCE_M = 10
/** A circle tighter than the minimum turn radius can't physically be flown —
 * orbit at least this multiple of it, leaving headroom for noise and wind. */
const LOITER_MIN_RADIUS_TURN_RADII = 1.1
/** Once a target is unreachable from inside the turning circle, fly straight
 * until it's at least this many turn radii away, then turn back. Tuned by
 * simulation: smaller values settle into a non-converging orbit. */
const EXTEND_UNTIL_TURN_RADII = 2.5

/** Tightest circle the aircraft can fly at cruise speed and max turn rate. */
export function minTurnRadiusM(maxTurnRateDegPerS: number): number {
  return CRUISE_SPEED_MPS / ((maxTurnRateDegPerS * Math.PI) / 180)
}

const FLYING_PHASES: SimPhase[] = ['takeoff', 'transition', 'cruise', 'loiter', 'rtl', 'qland']

export function initialSimState(home: HomePosition, clockMs = Date.now()): SimState {
  return {
    phase: 'idle',
    paused: false,
    armed: false,
    position: { lat: home.lat, lon: home.lon, altRelM: 0, altAmslM: home.altAmslM },
    home,
    target: null,
    legStart: null,
    targetAltM: null,
    headingDeg: 0,
    groundSpeedMps: 0,
    batteryPercent: 100,
    missionIndex: 0,
    phaseTimerS: 0,
    extending: false,
    loiterCenter: null,
    loiterRadiusM: 0,
    loiterSweptDeg: 0,
    loiterTargetDeg: 0,
    loiterUntilMs: null,
    takeoffAltM: 0,
    clockMs,
  }
}

export function isFlying(phase: SimPhase): boolean {
  return FLYING_PHASES.includes(phase)
}

export function deriveVtolState(phase: SimPhase): VtolState {
  switch (phase) {
    case 'idle':
    case 'takeoff':
    case 'landed':
      return 'mc'
    case 'transition':
    case 'qland':
      return 'transition'
    case 'cruise':
    case 'loiter':
    case 'rtl':
      return 'fw'
  }
}

export function startMission(state: SimState, mission: Mission): SimState {
  const first = mission.items[0]
  const takeoffAltM = first && first.type === 'vtolTakeoff' ? first.altM : 50

  // headingDeg otherwise only updates during cruise/rtl, so without this a
  // takeoff straight after a previous RTL-to-home leg would keep facing
  // wherever that leg last pointed — stale and, during the vertical-only
  // takeoff/transition phases that follow, not even matching any actual
  // horizontal motion at all.
  const firstTarget = mission.items[1] ? itemPosition(mission.items[1]) : null
  const headingDeg = firstTarget ? bearingDeg(state.position, firstTarget) : state.headingDeg

  return {
    ...state,
    phase: 'takeoff',
    missionIndex: 0,
    target: null,
    phaseTimerS: 0,
    groundSpeedMps: 0,
    takeoffAltM,
    headingDeg,
  }
}

export function startRtl(state: SimState): SimState {
  return {
    ...state,
    phase: 'rtl',
    target: { lat: state.home.lat, lon: state.home.lon },
    legStart: { lat: state.position.lat, lon: state.position.lon },
    targetAltM: null,
    groundSpeedMps: CRUISE_SPEED_MPS,
    extending: false,
  }
}

export function startQland(state: SimState): SimState {
  return { ...state, phase: 'qland', target: null, groundSpeedMps: 0 }
}

export function setPaused(state: SimState, paused: boolean): SimState {
  return { ...state, paused }
}

function advanceMissionItem(state: SimState, mission: Mission): SimState {
  const nextIndex = state.missionIndex + 1
  const item = mission.items[nextIndex]

  if (!item) return { ...state, phase: 'landed', target: null, groundSpeedMps: 0 }

  // The leg about to start is the prescribed line from the item just
  // completed to the next one — not wherever the aircraft's actual
  // (possibly overshot) arrival position ended up. The item just completed
  // is at the *current* missionIndex; vtolTakeoff has no position, so the
  // first leg out of takeoff is prescribed from home.
  const prevItem = mission.items[state.missionIndex]
  const legStart = (prevItem ? itemPosition(prevItem) : null) ?? { lat: state.home.lat, lon: state.home.lon }

  switch (item.type) {
    case 'returnToLaunch':
      return {
        ...state,
        missionIndex: nextIndex,
        phase: 'rtl',
        target: { lat: state.home.lat, lon: state.home.lon },
        legStart,
        targetAltM: null,
        groundSpeedMps: CRUISE_SPEED_MPS,
        extending: false,
      }
    case 'waypoint':
    case 'loiter':
    case 'vtolLand':
      return {
        ...state,
        missionIndex: nextIndex,
        phase: 'cruise',
        target: { lat: item.lat, lon: item.lon },
        legStart,
        targetAltM: item.type === 'vtolLand' ? 0 : item.altM,
        groundSpeedMps: CRUISE_SPEED_MPS,
        extending: false,
      }
    case 'vtolTakeoff':
      // Mission validation forbids this mid-mission; land in place rather than loop forever.
      return { ...state, phase: 'landed', target: null, groundSpeedMps: 0 }
  }
}

function batteryDrainPerSecond(phase: SimPhase): number {
  return isFlying(phase) ? 0.05 : 0.005
}

/** Whether `target` sits inside the circle the aircraft would trace turning
 * toward it at max rate — i.e. it can't be reached by turning, only by first
 * flying away to open up room. */
function targetInsideTurnCircle(position: GeoPoint, headingDeg: number, target: GeoPoint, turnRadiusM: number): boolean {
  const errDeg = angleDiffDeg(headingDeg, bearingDeg(position, target))
  if (Math.abs(errDeg) <= 1) return false
  const centerBearingRad = ((headingDeg + Math.sign(errDeg) * 90) * Math.PI) / 180
  const turnCenter = fromLocalEastNorthM(position, turnRadiusM * Math.sin(centerBearingRad), turnRadiusM * Math.cos(centerBearingRad))
  return haversineDistanceM(turnCenter, target) < turnRadiusM
}

/** One tick of flight physics shared by every phase that flies in fixed-wing
 * mode: turn toward `desiredHeadingDeg` at no more than the max turn rate
 * (+ wobble), then advance position by the wind-affected ground velocity. */
function flyHeading(
  state: SimState,
  desiredHeadingDeg: number,
  dtS: number,
  physics: FlightPhysicsConfig,
): { position: Position; headingDeg: number; groundSpeedMps: number } {
  const turnedHeadingDeg = turnToward(state.headingDeg, desiredHeadingDeg, physics.maxTurnRateDegPerS, dtS)
  const headingDeg = applyHeadingNoise(turnedHeadingDeg, physics.headingNoiseDegPerS, dtS, physics.rng)
  const { eastMps, northMps } = groundVelocityMps(headingDeg, CRUISE_SPEED_MPS, physics.wind)
  const groundSpeedMps = Math.hypot(eastMps, northMps)
  const position = { ...state.position, ...stepPosition(state.position, eastMps, northMps, dtS) }
  return { position, headingDeg, groundSpeedMps }
}

/** Look-ahead guidance toward `target` along the legStart -> target line,
 * for `cruise` and `rtl`. A target that has ended up inside the aircraft's
 * turning circle (e.g. just overshot, or a point it's circling tangentially)
 * can't be reached by turning toward it — chasing it anyway just orbits it
 * forever — so it latches into flying straight until the target is a few
 * turn radii away, then turns back: the same extend-and-return a real
 * fixed-wing has to make. */
function stepToward(
  state: SimState,
  target: GeoPoint,
  dtS: number,
  physics: FlightPhysicsConfig,
): { position: Position; headingDeg: number; groundSpeedMps: number; remainingM: number; extending: boolean } {
  const turnRadiusM = minTurnRadiusM(physics.maxTurnRateDegPerS)
  const distanceM = haversineDistanceM(state.position, target)

  let extending = state.extending
  if (!extending && targetInsideTurnCircle(state.position, state.headingDeg, target, turnRadiusM)) extending = true
  if (extending && distanceM >= EXTEND_UNTIL_TURN_RADII * turnRadiusM) extending = false

  const legStart = state.legStart ?? state.position
  const carrot = lookAheadPoint(state.position, legStart, target, physics.lookAheadM)
  const desiredHeadingDeg = extending ? state.headingDeg : bearingDeg(state.position, carrot)

  const flown = flyHeading(state, desiredHeadingDeg, dtS, physics)
  return { ...flown, remainingM: haversineDistanceM(flown.position, target), extending }
}

/** `clockMs` is the time of day this step lands on. The live drone passes the
 * real wall clock (see DroneEngine.tick) so clock-mode loiters end when the
 * operator's watch says, whatever the sim speed; left out, the clock just
 * advances by dtS, which keeps unit tests deterministic. */
export function stepSim(
  state: SimState,
  mission: Mission | null,
  dtS: number,
  physics: FlightPhysicsConfig = defaultFlightPhysicsConfig(),
  clockMs: number = state.clockMs + dtS * 1000,
): SimState {
  // Time passes whatever the phase (paused included).
  return stepFlight({ ...state, clockMs }, mission, dtS, physics)
}

function stepFlight(state: SimState, mission: Mission | null, dtS: number, physics: FlightPhysicsConfig): SimState {
  const batteryPercent = Math.max(0, state.batteryPercent - batteryDrainPerSecond(state.phase) * dtS)

  if (state.paused || !mission) {
    return { ...state, batteryPercent }
  }

  switch (state.phase) {
    case 'idle':
    case 'landed':
      return { ...state, batteryPercent }

    case 'takeoff': {
      const altRelM = Math.min(state.takeoffAltM, state.position.altRelM + TAKEOFF_CLIMB_MPS * dtS)
      const reached = altRelM >= state.takeoffAltM
      return {
        ...state,
        batteryPercent,
        position: { ...state.position, altRelM },
        phase: reached ? 'transition' : 'takeoff',
        phaseTimerS: reached ? 0 : state.phaseTimerS,
      }
    }

    case 'transition': {
      const phaseTimerS = state.phaseTimerS + dtS
      if (phaseTimerS < TRANSITION_DURATION_S) {
        return { ...state, batteryPercent, phaseTimerS }
      }
      return advanceMissionItem({ ...state, batteryPercent, phaseTimerS: 0 }, mission)
    }

    case 'cruise': {
      if (!state.target) return { ...state, batteryPercent }
      const item = mission.items[state.missionIndex]
      const acceptRadiusM = item?.type === 'waypoint' ? (item.acceptRadiusM ?? DEFAULT_ACCEPT_RADIUS_M) : DEFAULT_ACCEPT_RADIUS_M

      const {
        position: horizontalPosition,
        headingDeg,
        groundSpeedMps,
        remainingM: horizontalRemainingM,
        extending,
      } = stepToward(state, state.target, dtS, physics)

      // Climb/descend toward the item's own altitude over the leg, so
      // "cleared" (below) is a genuine 3D check rather than just overhead —
      // without this an item below/above the current altitude would never
      // actually be reachable in Z, and the aircraft would circle forever.
      const altRelM =
        state.targetAltM !== null
          ? stepToward1D(horizontalPosition.altRelM, state.targetAltM, CRUISE_VERTICAL_RATE_MPS * dtS)
          : horizontalPosition.altRelM
      const position: Position = { ...horizontalPosition, altRelM }
      const verticalRemainingM = state.targetAltM !== null ? Math.abs(altRelM - state.targetAltM) : 0
      const remainingM = Math.hypot(horizontalRemainingM, verticalRemainingM)

      const next: SimState = { ...state, batteryPercent, position, headingDeg, groundSpeedMps, extending }

      // A loiter hands over to loiter guidance once the aircraft is within
      // LOITER_TANGENT_ENTRY_M of the circle's edge — not on reaching its
      // center. Position/heading carry over as-is.
      if (item?.type === 'loiter') {
        const loiterCenter = { lat: item.lat, lon: item.lon }
        const orbitRadiusM = Math.max(item.radiusM, LOITER_MIN_RADIUS_TURN_RADII * minTurnRadiusM(physics.maxTurnRateDegPerS))
        if (haversineDistanceM(position, loiterCenter) > orbitRadiusM + LOITER_TANGENT_ENTRY_M) return next
        return {
          ...next,
          phase: 'loiter',
          loiterCenter,
          loiterRadiusM: item.radiusM,
          loiterSweptDeg: 0,
          // Clock mode still always flies at least one lap.
          loiterTargetDeg: (item.untilUtcMinuteOfDay !== undefined ? 1 : (item.turns ?? 1)) * 360,
          loiterUntilMs: item.untilUtcMinuteOfDay !== undefined ? resolveLoiterUntilMs(next.clockMs, item.untilUtcMinuteOfDay) : null,
        }
      }

      // Not cleared yet (still off in 3D): keep tracking the *same* target —
      // legStart/target are unchanged, so if the aircraft has already
      // overshot the waypoint horizontally while still converging in
      // altitude, guidance brings it back around for another pass rather
      // than cutting over to the next leg early.
      if (remainingM > acceptRadiusM) return next

      if (item?.type === 'vtolLand') {
        return { ...next, phase: 'qland', target: null, groundSpeedMps: 0 }
      }
      return advanceMissionItem(next, mission)
    }

    case 'loiter': {
      if (!state.loiterCenter) {
        return advanceMissionItem({ ...state, batteryPercent }, mission)
      }

      // Flown with the same rate-limited turn and wind-affected velocity as
      // every other leg, never a scripted position/heading. A radius tighter
      // than the aircraft can turn is flown at its minimum instead.
      const center = state.loiterCenter
      const orbitRadiusM = Math.max(state.loiterRadiusM, LOITER_MIN_RADIUS_TURN_RADII * minTurnRadiusM(physics.maxTurnRateDegPerS))
      const radialBearingDeg = bearingDeg(center, state.position)
      const distanceM = haversineDistanceM(center, state.position)
      const offCircleM = distanceM - orbitRadiusM

      let desiredHeadingDeg: number
      if (offCircleM > LOITER_ON_CIRCLE_TOLERANCE_M) {
        // Outside the circle: steer for the tangent point — where a straight
        // line from here just touches the circle heading clockwise — so the
        // aircraft joins the lap already flying along it. Recomputed every
        // tick, so it converges onto that tangent line.
        const tangentBearingDeg = radialBearingDeg + (Math.acos(orbitRadiusM / distanceM) * 180) / Math.PI
        const tangentRad = (tangentBearingDeg * Math.PI) / 180
        const tangentPoint = fromLocalEastNorthM(center, orbitRadiusM * Math.sin(tangentRad), orbitRadiusM * Math.cos(tangentRad))
        desiredHeadingDeg = bearingDeg(state.position, tangentPoint)
      } else {
        // On (or inside) the circle: the clockwise tangent, bent back toward
        // the circle in proportion to how far off it the aircraft is.
        desiredHeadingDeg = radialBearingDeg + 90 + (Math.atan2(offCircleM, LOITER_CONVERGE_M) * 180) / Math.PI
      }
      const flown = flyHeading(state, desiredHeadingDeg, dtS, physics)

      const altRelM =
        state.targetAltM !== null
          ? stepToward1D(flown.position.altRelM, state.targetAltM, CRUISE_VERTICAL_RATE_MPS * dtS)
          : flown.position.altRelM
      const position: Position = { ...flown.position, altRelM }

      // Only genuine progress around the circle counts toward the lap, not
      // the curve in from outside it.
      const onCircle = Math.abs(haversineDistanceM(center, position) - orbitRadiusM) <= LOITER_ON_CIRCLE_TOLERANCE_M
      const loiterSweptDeg = onCircle
        ? state.loiterSweptDeg + angleDiffDeg(radialBearingDeg, bearingDeg(center, position))
        : state.loiterSweptDeg
      const headingDeg = flown.headingDeg

      const next: SimState = {
        ...state,
        batteryPercent,
        position,
        headingDeg,
        groundSpeedMps: flown.groundSpeedMps,
        loiterSweptDeg,
      }

      // Clock mode: keep lapping until the end time. The lap target trails
      // the laps flown meanwhile, so once time is up the exit below still
      // has its usual "peel off within one more lap" cap.
      if (state.loiterUntilMs !== null && next.clockMs < state.loiterUntilMs) {
        return { ...next, loiterTargetDeg: Math.max(state.loiterTargetDeg, loiterSweptDeg) }
      }

      // At least the required laps (minimum one) before considering an exit.
      if (loiterSweptDeg < state.loiterTargetDeg) return next

      const nextItem = mission.items[state.missionIndex + 1]
      const nextTarget = nextItem ? (itemPosition(nextItem) ?? (nextItem.type === 'returnToLaunch' ? state.home : null)) : null
      if (!nextTarget) return advanceMissionItem(next, mission)

      // A next target inside the circle (e.g. land at the loiter point) can
      // never be "aligned for" — the heading is tangential everywhere on the
      // circle — so just hand off; stepToward flies out and turns back in.
      if (haversineDistanceM(center, nextTarget) <= orbitRadiusM) return advanceMissionItem(next, mission)

      // Otherwise: keep circling a little past the minimum lap until the
      // heading roughly points along the next leg, so it peels off smoothly
      // rather than from a perpendicular approach. Capped at one extra lap
      // so an unusual geometry can't loiter forever.
      const bearingToNext = bearingDeg(next.position, nextTarget)
      const aligned = Math.abs(angleDiffDeg(headingDeg, bearingToNext)) < LOITER_EXIT_ALIGNMENT_TOLERANCE_DEG
      const forcedExit = loiterSweptDeg >= state.loiterTargetDeg + 360
      if (!aligned && !forcedExit) return next

      return advanceMissionItem(next, mission)
    }

    case 'rtl': {
      if (!state.target) return { ...state, batteryPercent, phase: 'qland', groundSpeedMps: 0 }
      const { position, headingDeg, groundSpeedMps, remainingM, extending } = stepToward(state, state.target, dtS, physics)
      const next: SimState = { ...state, batteryPercent, position, headingDeg, groundSpeedMps, extending }
      return remainingM <= DEFAULT_ACCEPT_RADIUS_M ? { ...next, phase: 'qland', target: null, groundSpeedMps: 0 } : next
    }

    case 'qland': {
      const altRelM = Math.max(0, state.position.altRelM - LAND_DESCENT_MPS * dtS)
      const landed = altRelM <= 0
      return {
        ...state,
        batteryPercent,
        position: { ...state.position, altRelM },
        phase: landed ? 'landed' : 'qland',
        groundSpeedMps: 0,
      }
    }
  }
}
