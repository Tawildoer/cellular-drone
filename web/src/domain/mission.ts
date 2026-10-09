export interface GeoPoint {
  lat: number
  lon: number
}

export type MissionItem =
  | { type: 'vtolTakeoff'; altM: number }
  | { type: 'waypoint'; lat: number; lon: number; altM: number; acceptRadiusM?: number }
  | {
      type: 'loiter'
      lat: number
      lon: number
      altM: number
      radiusM: number
      /** Laps mode: how many full laps to fly (default 1). Ignored when
       * `untilUtcMinuteOfDay` is set. */
      turns?: number
      /** Clock mode: keep lapping until this time of day, as minutes after
       * midnight UTC (0–1439) — a time of day rather than a fixed date so a
       * saved mission can be re-flown another day. Always at least one lap. */
      untilUtcMinuteOfDay?: number
    }
  | { type: 'vtolLand'; lat: number; lon: number }
  | { type: 'returnToLaunch' }

export interface Fence {
  /** Closed polygon in app vocabulary; first/last point need not repeat. */
  polygon: GeoPoint[]
  maxAltM?: number
}

export interface Mission {
  id: string
  name: string
  items: MissionItem[]
  fence?: Fence
  createdAt: number
  updatedAt: number
}

export const MINUTES_PER_DAY = 24 * 60
const MS_PER_MINUTE = 60_000
const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE

/** The concrete instant a loiter's time-of-day end refers to, as seen at
 * `nowMs`: whichever occurrence of that UTC time of day lies within 12h
 * either side of now. So "until 14:30" reached at 14:35 means today's
 * (already past, so just the minimum lap), and "until 00:10" reached at
 * 23:50 means after midnight — never a near-24h wait from being minutes late. */
export function resolveLoiterUntilMs(nowMs: number, untilUtcMinuteOfDay: number): number {
  const utcMidnightMs = Math.floor(nowMs / MS_PER_DAY) * MS_PER_DAY
  let untilMs = utcMidnightMs + untilUtcMinuteOfDay * MS_PER_MINUTE
  if (untilMs - nowMs > MS_PER_DAY / 2) untilMs -= MS_PER_DAY
  if (nowMs - untilMs > MS_PER_DAY / 2) untilMs += MS_PER_DAY
  return untilMs
}

/** Mission items that carry a lat/lon, in app vocabulary. */
export function itemPosition(item: MissionItem): GeoPoint | null {
  switch (item.type) {
    case 'waypoint':
    case 'loiter':
    case 'vtolLand':
      return { lat: item.lat, lon: item.lon }
    case 'vtolTakeoff':
    case 'returnToLaunch':
      return null
  }
}

/** The item's name in the UI, e.g. "Waypoint". */
export function missionItemLabel(item: MissionItem): string {
  switch (item.type) {
    case 'vtolTakeoff':
      return 'Takeoff'
    case 'waypoint':
      return 'Waypoint'
    case 'loiter':
      return 'Loiter'
    case 'vtolLand':
      return 'Land'
    case 'returnToLaunch':
      return 'Return to launch'
  }
}

