import { validateMission } from './validation'
import type { Mission } from './mission'
import type { VehicleState } from './vehicle'

export interface PreflightCheckItem {
  id: string
  label: string
  passed: boolean
}

export interface PreflightResult {
  ready: boolean
  items: PreflightCheckItem[]
}

export interface PreflightOptions {
  minSatellites?: number
  minBatteryPercent?: number
}

const DEFAULT_MIN_SATELLITES = 6
const DEFAULT_MIN_BATTERY_PERCENT = 30

export function evaluatePreflight(
  state: VehicleState,
  mission: Mission | null,
  opts: PreflightOptions = {},
): PreflightResult {
  const minSatellites = opts.minSatellites ?? DEFAULT_MIN_SATELLITES
  const minBatteryPercent = opts.minBatteryPercent ?? DEFAULT_MIN_BATTERY_PERCENT

  const hasGpsFix = state.gps.fixType === 'fix3d' || state.gps.fixType === 'rtk'
  const missionValid = mission !== null && mission.items.length > 0 && validateMission(mission).valid
  const noFailsafe = !Object.values(state.failsafe).some(Boolean)

  const items: PreflightCheckItem[] = [
    { id: 'gpsFix', label: 'GPS 3D fix or better', passed: hasGpsFix },
    { id: 'gpsSatellites', label: `At least ${minSatellites} satellites`, passed: state.gps.satellites >= minSatellites },
    { id: 'battery', label: `Battery at least ${minBatteryPercent}%`, passed: state.battery.percent >= minBatteryPercent },
    { id: 'missionLoaded', label: 'Mission loaded', passed: mission !== null && mission.items.length > 0 },
    { id: 'missionValid', label: 'Mission passes validation', passed: missionValid },
    { id: 'noFailsafe', label: 'No active failsafe', passed: noFailsafe },
    { id: 'rcLinked', label: 'RC link present', passed: state.rc.linked },
    // Unknown passes here: the vehicle checks it again on start.
    {
      id: 'rcSwitchAuto',
      label: state.rc.modeSwitch && state.rc.modeSwitch !== 'AUTO'
        ? `RC mode switch at AUTO (now ${state.rc.modeSwitch})`
        : 'RC mode switch at AUTO',
      passed: state.rc.modeSwitch === undefined || state.rc.modeSwitch === 'AUTO',
    },
  ]

  return { ready: items.every((item) => item.passed), items }
}
