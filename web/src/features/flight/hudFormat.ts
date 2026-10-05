import { BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, type LucideIcon } from 'lucide-react'
import type { GpsFixType, VehicleState } from '../../domain'
import type { StatStatus } from '../../components/StatTile'

export function formatHeadingDeg(yawDeg: number): string {
  const normalized = ((yawDeg % 360) + 360) % 360
  return `${Math.round(normalized).toString().padStart(3, '0')}°`
}

export function batteryStatus(percent: number): StatStatus {
  if (percent < 20) return 'critical'
  if (percent < 40) return 'warning'
  return 'good'
}

export function batteryIcon(percent: number): LucideIcon {
  if (percent < 20) return BatteryWarning
  if (percent < 40) return BatteryLow
  if (percent < 70) return BatteryMedium
  return BatteryFull
}

export function gpsFixLabel(fixType: GpsFixType): string {
  switch (fixType) {
    case 'none':
      return 'No fix'
    case 'fix2d':
      return '2D fix'
    case 'fix3d':
      return '3D fix'
    case 'rtk':
      return 'RTK'
  }
}

export function gpsStatus(fixType: GpsFixType): StatStatus {
  switch (fixType) {
    case 'none':
      return 'critical'
    case 'fix2d':
      return 'warning'
    case 'fix3d':
    case 'rtk':
      return 'good'
  }
}

export function vtolStateLabel(state: VehicleState['vtolState']): string {
  switch (state) {
    case 'mc':
      return 'MC'
    case 'fw':
      return 'FW'
    case 'transition':
      return 'Transition'
  }
}
