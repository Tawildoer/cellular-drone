import type { GeoPoint, HomePosition, Mission, MissionItem, VehicleMissionItem } from '../domain'

/**
 * App `Mission` → ArduPlane mission, fence and params (docs/MAVLINK.md,
 * ADR-0017). This is the browser's **preview** translator: it drives the
 * planner's "ArduPilot view" and the .waypoints export. The drone agent's
 * Go translator (agent/internal/mission) is the authoritative one; both are
 * held to the same golden files in testdata/mission-translation/, so change
 * them together.
 */

/** MAV_CMD values used here. */
export const MavCmd = {
  NAV_WAYPOINT: 16,
  NAV_LOITER_UNLIM: 17,
  NAV_LOITER_TURNS: 18,
  NAV_RETURN_TO_LAUNCH: 20,
  NAV_VTOL_TAKEOFF: 84,
  NAV_VTOL_LAND: 85,
  NAV_FENCE_POLYGON_VERTEX_INCLUSION: 5001,
} as const

/** MAV_FRAME values used here. */
export const MavFrame = {
  /** Altitude above mean sea level. ArduPilot's home row uses it. */
  GLOBAL: 0,
  /** Altitude above home: every mission item (`altM` is relative to home). */
  GLOBAL_RELATIVE_ALT: 3,
} as const

/** ArduPilot packs a waypoint's accept radius and a loiter's turn count
 * into one byte each. */
const MAX_BYTE = 255
/** Above 255 m, ArduPilot stores a LOITER_TURNS radius in tens of metres,
 * still in one byte. */
const MAX_LOITER_TURNS_RADIUS_M = 2550

export type TranslationIssueCode =
  | 'home_unknown'
  | 'loiter_until_not_native'
  | 'loiter_radius_rounded'
  | 'loiter_radius_too_large'
  | 'loiter_turns_too_many'
  | 'accept_radius_too_large'
  | 'fence_separate_upload'

export interface TranslationIssue {
  /** App item index, or null for the mission as a whole. */
  itemIndex: number | null
  code: TranslationIssueCode
  /** `error`: ArduPlane would fly something other than what was planned. */
  severity: 'error' | 'warning' | 'info'
  message: string
}

export interface ArduPilotMission {
  /** Mission list, seq 0 = home. */
  items: VehicleMissionItem[]
  /** Fence list (mission type FENCE), empty when the mission has no fence. */
  fence: VehicleMissionItem[]
  /** Parameters the agent sets alongside the upload. */
  params: Record<string, number>
  issues: TranslationIssue[]
}

function row(
  seq: number,
  command: number,
  frame: number,
  params: [number, number, number, number],
  point: { lat: number; lon: number; altM: number },
  appIndex: number | null,
): VehicleMissionItem {
  return { seq, command, frame, params, lat: point.lat, lon: point.lon, altM: point.altM, appIndex }
}

const NO_PARAMS: [number, number, number, number] = [0, 0, 0, 0]
const NO_POSITION = { lat: 0, lon: 0, altM: 0 }

function at(point: GeoPoint, altM: number) {
  return { lat: point.lat, lon: point.lon, altM }
}

/** One app item → one ArduPlane row (no item expands into several yet). */
function translateItem(item: MissionItem, index: number, issues: TranslationIssue[]): VehicleMissionItem {
  const seq = index + 1
  const frame = MavFrame.GLOBAL_RELATIVE_ALT

  switch (item.type) {
    case 'vtolTakeoff':
      // Climbs over wherever it is; ArduPlane ignores lat/lon.
      return row(seq, MavCmd.NAV_VTOL_TAKEOFF, frame, NO_PARAMS, { ...NO_POSITION, altM: item.altM }, index)

    case 'waypoint': {
      let acceptRadiusM = Math.trunc(item.acceptRadiusM ?? 0)
      if (acceptRadiusM > MAX_BYTE) {
        issues.push({
          itemIndex: index,
          code: 'accept_radius_too_large',
          severity: 'error',
          message: `Accept radius ${item.acceptRadiusM} m is over ArduPilot's ${MAX_BYTE} m limit`,
        })
        acceptRadiusM = MAX_BYTE
      }
      // param2 = accept radius; 0 means "use WP_RADIUS".
      return row(seq, MavCmd.NAV_WAYPOINT, frame, [0, acceptRadiusM, 0, 0], at(item, item.altM), index)
    }

    case 'loiter': {
      if (item.untilUtcMinuteOfDay !== undefined) {
        issues.push({
          itemIndex: index,
          code: 'loiter_until_not_native',
          severity: 'warning',
          message:
            'ArduPilot has no "loiter until a time of day". This becomes an unlimited loiter that something else must end (agent or FC script, ADR-0017); otherwise it circles until the battery failsafe',
        })
        // Unlimited loiter keeps the radius as given (no byte packing).
        return row(seq, MavCmd.NAV_LOITER_UNLIM, frame, [0, 0, item.radiusM, 0], at(item, item.altM), index)
      }

      let turns = item.turns ?? 1
      if (turns > MAX_BYTE) {
        issues.push({
          itemIndex: index,
          code: 'loiter_turns_too_many',
          severity: 'error',
          message: `${turns} laps is over ArduPilot's ${MAX_BYTE}-lap limit`,
        })
        turns = MAX_BYTE
      }
      const radiusM = loiterTurnsRadiusOnVehicle(item.radiusM, index, issues)
      // param3 = radius (positive = clockwise), param4 = 1: leave along the
      // next leg rather than from wherever the last lap ends (ADR-0013).
      return row(seq, MavCmd.NAV_LOITER_TURNS, frame, [turns, 0, radiusM, 1], at(item, item.altM), index)
    }

    case 'vtolLand':
      return row(seq, MavCmd.NAV_VTOL_LAND, frame, NO_PARAMS, at(item, 0), index)

    case 'returnToLaunch':
      // VTOL landing at home comes from Q_RTL_MODE, a vehicle parameter.
      return row(seq, MavCmd.NAV_RETURN_TO_LAUNCH, frame, NO_PARAMS, NO_POSITION, index)
  }
}

/** The radius ArduPilot will actually hold: whole metres up to 255, then
 * rounded down to tens of metres (it packs the radius into one byte). */
function loiterTurnsRadiusOnVehicle(radiusM: number, index: number, issues: TranslationIssue[]): number {
  const wholeM = Math.trunc(radiusM)
  if (wholeM <= MAX_BYTE) return wholeM

  if (wholeM > MAX_LOITER_TURNS_RADIUS_M) {
    issues.push({
      itemIndex: index,
      code: 'loiter_radius_too_large',
      severity: 'error',
      message: `Loiter radius ${radiusM} m is over ArduPilot's ${MAX_LOITER_TURNS_RADIUS_M} m limit for counted laps`,
    })
    return MAX_LOITER_TURNS_RADIUS_M
  }

  const stored = Math.floor(wholeM / 10) * 10
  if (stored !== radiusM) {
    issues.push({
      itemIndex: index,
      code: 'loiter_radius_rounded',
      severity: 'info',
      message: `ArduPilot stores radii over ${MAX_BYTE} m in tens of metres: ${radiusM} m becomes ${stored} m`,
    })
  }
  return stored
}

/**
 * Translates an app mission. `home` fills seq 0; without one the row is a
 * placeholder, which is harmless because ArduPilot resets home when it arms.
 * Doesn't validate the mission (that's domain/validation): it reports only
 * where ArduPlane would store or fly something differently.
 */
export function translateMission(mission: Mission, home: HomePosition | null): ArduPilotMission {
  const issues: TranslationIssue[] = []

  if (!home) {
    issues.push({
      itemIndex: null,
      code: 'home_unknown',
      severity: 'info',
      message: 'No vehicle home yet, so the home row is a placeholder. ArduPilot sets home when it arms',
    })
  }
  const homeRow = row(
    0,
    MavCmd.NAV_WAYPOINT,
    MavFrame.GLOBAL,
    NO_PARAMS,
    home ? { lat: home.lat, lon: home.lon, altM: home.altAmslM } : NO_POSITION,
    null,
  )

  const items = [homeRow, ...mission.items.map((item, index) => translateItem(item, index, issues))]

  const fence: VehicleMissionItem[] = []
  const params: Record<string, number> = {}
  if (mission.fence && mission.fence.polygon.length >= 3) {
    const count = mission.fence.polygon.length
    mission.fence.polygon.forEach((vertex, seq) => {
      fence.push(
        row(seq, MavCmd.NAV_FENCE_POLYGON_VERTEX_INCLUSION, MavFrame.GLOBAL, [count, 0, 0, 0], at(vertex, 0), null),
      )
    })
  }
  if (mission.fence?.maxAltM !== undefined) params.FENCE_ALT_MAX = mission.fence.maxAltM
  if (mission.fence) {
    issues.push({
      itemIndex: null,
      code: 'fence_separate_upload',
      severity: 'info',
      message:
        "The fence goes to the flight controller as its own upload plus FENCE_ALT_MAX. It isn't part of the .waypoints file, and it stays on the vehicle across missions",
    })
  }

  return { items, fence, params, issues }
}

/** The app item a flight-controller seq belongs to (MISSION_CURRENT →
 * MissionProgress.currentIndex), or null for home and added rows. */
export function appIndexForSeq(items: VehicleMissionItem[], seq: number): number | null {
  return items.find((item) => item.seq === seq)?.appIndex ?? null
}
