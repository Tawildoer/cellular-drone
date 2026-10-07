import type { VehicleMissionItem } from '../domain'

/**
 * The `QGC WPL 110` text format that Mission Planner, QGroundControl and
 * MAVProxy (`wp load`) all read: a header line, then one tab-separated row
 * per item — seq, current, frame, command, param1–4, lat, lon, alt,
 * autocontinue. Row 0 is home and is marked current, as Mission Planner
 * writes it.
 */
export function toWaypointsFile(items: VehicleMissionItem[]): string {
  const lines = ['QGC WPL 110']
  for (const item of items) {
    lines.push(
      [
        item.seq,
        item.seq === 0 ? 1 : 0,
        item.frame,
        item.command,
        ...item.params.map(formatNumber),
        item.lat.toFixed(8),
        item.lon.toFixed(8),
        item.altM.toFixed(6),
        1,
      ].join('\t'),
    )
  }
  return lines.join('\n') + '\n'
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(8) : String(value)
}

/** A filesystem-safe file name for a mission. */
export function waypointsFileName(missionName: string): string {
  const slug = missionName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'mission'}.waypoints`
}
