import type { VehicleMissionItem } from '../domain'
import { LOITER_UNTIL_SCRIPT_MSG_ID, MavCmd } from './translate'

const COMMAND_NAMES: Record<number, string> = {
  [MavCmd.NAV_WAYPOINT]: 'NAV_WAYPOINT',
  [MavCmd.NAV_LOITER_UNLIM]: 'NAV_LOITER_UNLIM',
  [MavCmd.NAV_LOITER_TURNS]: 'NAV_LOITER_TURNS',
  [MavCmd.NAV_RETURN_TO_LAUNCH]: 'NAV_RETURN_TO_LAUNCH',
  [MavCmd.NAV_VTOL_TAKEOFF]: 'NAV_VTOL_TAKEOFF',
  [MavCmd.NAV_VTOL_LAND]: 'NAV_VTOL_LAND',
  [MavCmd.DO_SEND_SCRIPT_MESSAGE]: 'DO_SEND_SCRIPT_MESSAGE',
  [MavCmd.NAV_FENCE_POLYGON_VERTEX_INCLUSION]: 'FENCE_POLYGON_VERTEX_INCLUSION',
}

export function commandName(command: number): string {
  return COMMAND_NAMES[command] ?? `MAV_CMD ${command}`
}

/** A one-line, human summary of a row's meaningful fields. */
export function describeItem(item: VehicleMissionItem): string {
  const [p1, p2, p3] = item.params
  const pos = `${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}`
  if (item.seq === 0 && item.appIndex === null && item.command === MavCmd.NAV_WAYPOINT) {
    return item.lat === 0 && item.lon === 0 ? 'home (set on arming)' : `home ${pos}`
  }
  switch (item.command) {
    case MavCmd.NAV_VTOL_TAKEOFF:
      return `climb to ${item.altM} m`
    case MavCmd.NAV_WAYPOINT:
      return `${pos} @ ${item.altM} m${p2 > 0 ? `, accept ${p2} m` : ''}`
    case MavCmd.NAV_LOITER_TURNS:
      return `${pos} @ ${item.altM} m, ${p1} lap${p1 === 1 ? '' : 's'}, r ${Math.abs(p3)} m${p3 < 0 ? ' CCW' : ''}`
    case MavCmd.NAV_LOITER_UNLIM:
      return `${pos} @ ${item.altM} m, r ${Math.abs(p3)} m, no end`
    case MavCmd.NAV_VTOL_LAND:
      return `land at ${pos}`
    case MavCmd.NAV_RETURN_TO_LAUNCH:
      return 'return home, VTOL land (Q_RTL_MODE)'
    case MavCmd.DO_SEND_SCRIPT_MESSAGE:
      if (p1 === LOITER_UNTIL_SCRIPT_MSG_ID) {
        const minute = Math.round(p2)
        const hhmm = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
        return `loiter_until.lua: end the loiter at ${hhmm} UTC`
      }
      return `script message ${p1}`
    default:
      return `${pos} @ ${item.altM} m, p ${item.params.join('/')}`
  }
}

/** ArduPilot stores lat/lon as 1e-7 degree integers and altitude in cm, so
 * a readback never matches the upload bit for bit. */
const LATLON_TOLERANCE_DEG = 2e-7
const ALT_TOLERANCE_M = 0.02
const PARAM_TOLERANCE = 1e-3

function sameItem(a: VehicleMissionItem, b: VehicleMissionItem): boolean {
  return (
    a.seq === b.seq &&
    a.command === b.command &&
    a.params.every((p, i) => Math.abs(p - (b.params[i] ?? NaN)) <= PARAM_TOLERANCE) &&
    Math.abs(a.lat - b.lat) <= LATLON_TOLERANCE_DEG &&
    Math.abs(a.lon - b.lon) <= LATLON_TOLERANCE_DEG &&
    Math.abs(a.altM - b.altM) <= ALT_TOLERANCE_M
  )
}

/** Whether two mission lists say the same thing, ignoring home (seq 0),
 * which ArduPilot rewrites when it arms. Frames aren't compared: ArduPilot
 * reads back its own frame for a row. */
export function sameMissionItems(a: VehicleMissionItem[], b: VehicleMissionItem[]): boolean {
  const withoutHome = (items: VehicleMissionItem[]) => items.filter((item) => item.seq !== 0)
  const left = withoutHome(a)
  const right = withoutHome(b)
  return left.length === right.length && left.every((item, i) => sameItem(item, right[i]!))
}
