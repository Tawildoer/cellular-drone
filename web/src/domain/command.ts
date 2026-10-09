import type { GeoPoint } from './mission'
import type { GimbalTarget } from './vehicle'

export type VideoPreset = 'low' | 'medium' | 'high'

/** Ground distance from the aircraft within which the gimbal can lock onto a
 * spot; beyond it the lock releases on its own (ADR-0023). */
export const GIMBAL_LOCK_RANGE_M = 500

/** The height free-fly waypoints are flown at, above home (ADR-0024). */
export const FREE_FLY_ALT_M = 60

/** The circle free fly flies round a loiter waypoint, and round the last
 * waypoint while waiting for another. */
export const FREE_FLY_LOITER_RADIUS_M = 80

/**
 * The full set of commands the browser may send. There is deliberately no
 * manual-control variant (no RC_CHANNELS_OVERRIDE / MANUAL_CONTROL / setpoints) —
 * see CLAUDE.md and ADR-0008. The physical ELRS radio is the only manual path.
 */
export type Command =
  | { type: 'arm' }
  | { type: 'disarm' }
  | { type: 'mission.start' }
  | { type: 'mode.pause' }
  | { type: 'mode.resume' }
  | { type: 'mode.rtl' }
  | { type: 'mode.qland' }
  | { type: 'video.config'; preset: VideoPreset }
  /** Point the gimbal camera at a spot on the ground and hold it there as the
   * aircraft flies, until the aircraft is more than GIMBAL_LOCK_RANGE_M away
   * (ADR-0023). Camera only: never moves the aircraft. */
  | { type: 'gimbal.lock'; target: GimbalTarget }
  /** Drop the lock: back to looking ahead (or at a loiter's centre). */
  | { type: 'gimbal.release' }
  /** Take over an airborne drone into free fly at `altM` (ADR-0024): it
   * circles where it is until given a waypoint. Ends with RTL or QLAND. */
  | { type: 'freefly.start'; altM: number }
  /** Add a waypoint to the end of the free-fly route, at its height. */
  | { type: 'freefly.waypoint'; lat: number; lon: number }
  /** Remove a free-fly waypoint not yet reached. `at` is where the browser
   * saw it, so an edit to a route that has since changed is refused. */
  | { type: 'freefly.remove'; index: number; at: GeoPoint }
  /** Turn a free-fly waypoint into a loiter (circled once, or until the next
   * waypoint if it's the last) or back into a plain waypoint. */
  | { type: 'freefly.loiter'; index: number; at: GeoPoint; loiter: boolean }

export type CommandRejectionReason =
  | 'rejected_by_vehicle'
  | 'blocked_rc_override'
  | 'preflight_failed'
  | 'timeout'
  | 'not_connected'
  | 'unauthorised'

export type CommandResult = { ok: true } | { ok: false; reason: CommandRejectionReason; detail?: string }
