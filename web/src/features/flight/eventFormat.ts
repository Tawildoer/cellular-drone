import type { StatStatus } from '../../components/StatTile'
import type { VehicleEvent } from '../../domain'

export function formatEventMessage(event: VehicleEvent): string {
  switch (event.kind) {
    case 'status':
      return event.text
    case 'failsafe':
      return `${event.flag.toUpperCase()} failsafe ${event.active ? 'ACTIVE' : 'cleared'}`
    case 'modeChanged':
      return `Mode changed to ${event.mode}`
    case 'rcOverride':
      return event.active ? 'RC override ACTIVE — browser control blocked' : 'RC override cleared'
  }
}

export function eventStatus(event: VehicleEvent): StatStatus | undefined {
  switch (event.kind) {
    case 'status':
      return undefined
    case 'failsafe':
      return event.active ? 'critical' : 'good'
    case 'modeChanged':
      return undefined
    case 'rcOverride':
      return event.active ? 'warning' : 'good'
  }
}

export function formatEventTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
