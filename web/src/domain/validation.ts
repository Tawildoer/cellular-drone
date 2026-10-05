import { isPointInPolygon, pathLengthM } from './geo'
import { itemPosition, MINUTES_PER_DAY, type GeoPoint, type Mission } from './mission'

export const DEFAULT_MAX_ALT_M = 120
/** Comfortably above the aircraft's minimum turn radius (~52m at cruise
 * speed and max turn rate), so any planned loiter is physically flyable. */
export const MIN_LOITER_RADIUS_M = 60

export interface MissionValidationIssue {
  itemIndex: number | null
  message: string
}

export interface MissionValidationResult {
  valid: boolean
  issues: MissionValidationIssue[]
}

export interface ValidateMissionOptions {
  maxAltM?: number
}

/** Mission validation rules from docs/FRONTEND.md: must start with a VTOL
 * takeoff and end with a land or RTL, respect altitude limits, and stay
 * inside the fence (when one is set). */
export function validateMission(mission: Mission, opts: ValidateMissionOptions = {}): MissionValidationResult {
  const maxAltM = opts.maxAltM ?? DEFAULT_MAX_ALT_M
  const issues: MissionValidationIssue[] = []
  const items = mission.items

  if (items.length === 0) {
    issues.push({ itemIndex: null, message: 'Mission has no items' })
    return { valid: false, issues }
  }

  const first = items[0]
  if (first && first.type !== 'vtolTakeoff') {
    issues.push({ itemIndex: 0, message: 'Mission must start with a VTOL takeoff' })
  }

  const last = items[items.length - 1]
  if (last && last.type !== 'vtolLand' && last.type !== 'returnToLaunch') {
    issues.push({ itemIndex: items.length - 1, message: 'Mission must end with a VTOL land or return-to-launch' })
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) continue

    const altM = 'altM' in item ? item.altM : null
    if (altM !== null && altM > maxAltM) {
      issues.push({ itemIndex: i, message: `Altitude ${altM}m exceeds the limit of ${maxAltM}m` })
    }

    if (item.type === 'loiter') {
      if (!(item.radiusM >= MIN_LOITER_RADIUS_M)) {
        issues.push({ itemIndex: i, message: `Loiter radius ${item.radiusM}m is below the minimum of ${MIN_LOITER_RADIUS_M}m` })
      }
      if (item.untilUtcMinuteOfDay !== undefined) {
        if (!Number.isInteger(item.untilUtcMinuteOfDay) || item.untilUtcMinuteOfDay < 0 || item.untilUtcMinuteOfDay >= MINUTES_PER_DAY) {
          issues.push({ itemIndex: i, message: 'Loiter end time is not a valid time of day' })
        }
      } else if (item.turns !== undefined && !(Number.isInteger(item.turns) && item.turns >= 1)) {
        issues.push({ itemIndex: i, message: `Loiter laps must be a whole number of at least 1` })
      }
    }

    if (mission.fence) {
      const point = itemPosition(item)
      if (point && !isPointInPolygon(point, mission.fence.polygon)) {
        issues.push({ itemIndex: i, message: 'Item falls outside the geofence' })
      }
      if (mission.fence.maxAltM !== undefined && altM !== null && altM > mission.fence.maxAltM) {
        issues.push({ itemIndex: i, message: `Altitude ${altM}m exceeds the fence limit of ${mission.fence.maxAltM}m` })
      }
    }
  }

  return { valid: issues.length === 0, issues }
}

/** Estimated time to complete the mission from a starting point, in seconds. */
export function estimateMissionEtaS(mission: Mission, fromPoint: GeoPoint, groundSpeedMps: number): number {
  if (groundSpeedMps <= 0) return Infinity

  const points: GeoPoint[] = [fromPoint]
  let loiterS = 0

  for (const item of mission.items) {
    const point = itemPosition(item)
    if (point) points.push(point)
    // Laps mode: that many laps around radiusM at cruise speed. Clock mode
    // depends on when the drone gets there, so only its guaranteed minimum
    // single lap is counted.
    if (item.type === 'loiter') {
      const laps = item.untilUtcMinuteOfDay !== undefined ? 1 : (item.turns ?? 1)
      loiterS += (laps * 2 * Math.PI * item.radiusM) / groundSpeedMps
    }
  }

  return pathLengthM(points) / groundSpeedMps + loiterS
}
