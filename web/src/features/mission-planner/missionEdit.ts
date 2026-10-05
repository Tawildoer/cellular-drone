import { itemPosition, MIN_LOITER_RADIUS_M, MINUTES_PER_DAY, type GeoPoint, type MissionItem } from '../../domain'

export const DEFAULT_TAKEOFF_ALT_M = 50
export const DEFAULT_WAYPOINT_ALT_M = 50
export const DEFAULT_LOITER_RADIUS_M = MIN_LOITER_RADIUS_M

/** A new draft's items: always starts valid (vtolTakeoff → returnToLaunch),
 * so the mission is never mid-construction-invalid — taps just insert
 * waypoints into the middle of an already-valid mission. */
export function skeletonItems(): MissionItem[] {
  return [{ type: 'vtolTakeoff', altM: DEFAULT_TAKEOFF_ALT_M }, { type: 'returnToLaunch' }]
}

/** Inserts a waypoint just before the final (ending) item. */
export function insertWaypoint(items: MissionItem[], point: GeoPoint, altM = DEFAULT_WAYPOINT_ALT_M): MissionItem[] {
  const insertIndex = Math.max(1, items.length - 1)
  const next = [...items]
  next.splice(insertIndex, 0, { type: 'waypoint', lat: point.lat, lon: point.lon, altM })
  return next
}

export function removeItemAt(items: MissionItem[], index: number): MissionItem[] {
  return items.filter((_, i) => i !== index)
}

export function updateItemAltitude(items: MissionItem[], index: number, altM: number): MissionItem[] {
  return items.map((item, i) => {
    if (i !== index) return item
    if (item.type === 'vtolTakeoff' || item.type === 'waypoint' || item.type === 'loiter') {
      return { ...item, altM }
    }
    return item
  })
}

/** Converts a waypoint item at `index` to a loiter (one full orbit by
 * default) or back, preserving its position/altitude either way. A no-op
 * on items without a position (takeoff, return-to-launch). */
export function setItemLoiter(items: MissionItem[], index: number, isLoiter: boolean): MissionItem[] {
  return items.map((item, i) => {
    if (i !== index) return item
    if (isLoiter) {
      if (item.type !== 'waypoint') return item
      return { type: 'loiter', lat: item.lat, lon: item.lon, altM: item.altM, radiusM: DEFAULT_LOITER_RADIUS_M, turns: 1 }
    }
    if (item.type !== 'loiter') return item
    return { type: 'waypoint', lat: item.lat, lon: item.lon, altM: item.altM }
  })
}

export function updateItemRadius(items: MissionItem[], index: number, radiusM: number): MissionItem[] {
  return items.map((item, i) => (i === index && item.type === 'loiter' ? { ...item, radiusM } : item))
}

/** Laps mode: lap `turns` times, dropping any clock-mode end time. */
export function setLoiterLaps(items: MissionItem[], index: number, turns: number): MissionItem[] {
  return items.map((item, i) => {
    if (i !== index || item.type !== 'loiter') return item
    const { untilUtcMinuteOfDay: _dropped, ...rest } = item
    return { ...rest, turns }
  })
}

/** Clock mode: lap until this UTC time of day, dropping any lap count. */
export function setLoiterUntil(items: MissionItem[], index: number, untilUtcMinuteOfDay: number): MissionItem[] {
  return items.map((item, i) => {
    if (i !== index || item.type !== 'loiter') return item
    const { turns: _dropped, ...rest } = item
    return { ...rest, untilUtcMinuteOfDay }
  })
}

function wrapMinuteOfDay(minutes: number): number {
  return ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
}

/** "HH:MM" in the operator's local time -> minutes after midnight UTC. */
export function localTimeToUtcMinuteOfDay(hhmm: string, now: Date = new Date()): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!match) return null
  const localMinutes = Number(match[1]) * 60 + Number(match[2])
  // getTimezoneOffset() is UTC minus local, in minutes.
  return wrapMinuteOfDay(localMinutes + now.getTimezoneOffset())
}

/** Minutes after midnight UTC -> "HH:MM" in the operator's local time. */
export function utcMinuteOfDayToLocalTime(utcMinuteOfDay: number, now: Date = new Date()): string {
  const local = wrapMinuteOfDay(utcMinuteOfDay - now.getTimezoneOffset())
  return `${String(Math.floor(local / 60)).padStart(2, '0')}:${String(local % 60).padStart(2, '0')}`
}

/** A sensible starting end time when switching to clock mode: 15 minutes
 * from now, rounded up to the next 5 minutes. */
export function defaultLoiterUntilUtcMinuteOfDay(now: Date = new Date()): number {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes() + 15
  return wrapMinuteOfDay(Math.ceil(utcMinutes / 5) * 5)
}

export function setEndingReturnToLaunch(items: MissionItem[]): MissionItem[] {
  if (items.length === 0) return items
  return [...items.slice(0, -1), { type: 'returnToLaunch' }]
}

/** Lands at the last waypoint's position — a no-op if there isn't one yet. */
export function setEndingLandAtLastWaypoint(items: MissionItem[]): MissionItem[] {
  if (items.length < 2) return items
  const precedingItem = items[items.length - 2]
  const point = precedingItem ? itemPosition(precedingItem) : null
  if (!point) return items
  return [...items.slice(0, -1), { type: 'vtolLand', lat: point.lat, lon: point.lon }]
}
