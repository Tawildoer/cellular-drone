import type { DrawerRow } from '../../components/HoverDrawer'
import type { FailsafeFlags, FlightMode, LinkStatus, VehicleState } from '../../domain'
import { formatHeadingDeg, gpsFixLabel, gpsStatus } from './hudFormat'
import { gradeHigherWorse, gradeLowerWorse, gradeStatus, THRESHOLDS } from './linkQuality'

/** The extra readings each top-bar tile's hover drawer shows. Pure, so the
 * drawers stay a view over the same VehicleState / LinkStatus as the tiles. */

const DASH = '—'

function num(value: number | undefined, digits: number, unit: string): string {
  return value === undefined || !Number.isFinite(value) ? DASH : `${value.toFixed(digits)} ${unit}`
}

function signed(value: number, digits: number, unit: string): string {
  const text = value.toFixed(digits)
  return `${value > 0 && Number(text) !== 0 ? '+' : ''}${text} ${unit}`
}

const MODE_MEANING: Record<FlightMode, string> = {
  AUTO: 'Flying the mission',
  LOITER: 'Circling in place',
  QLOITER: 'Hovering, holding position',
  RTL: 'Returning home',
  QLAND: 'Landing vertically',
  QHOVER: 'Hovering, holding height',
  FBWA: 'Pilot, stabilised',
  MANUAL: 'Pilot, unassisted',
  UNKNOWN: 'Not reported',
}

const FAILSAFE_LABEL: Record<keyof FailsafeFlags, string> = {
  gcs: 'GCS',
  battery: 'Battery',
  geofence: 'Geofence',
  rc: 'RC',
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

export function compassPoint(yawDeg: number): string {
  const normalized = ((yawDeg % 360) + 360) % 360
  return COMPASS[Math.round(normalized / 45) % 8] ?? 'N'
}

export function linkRows(link: LinkStatus | null): DrawerRow[] {
  if (!link || link.state === 'disconnected') return [{ label: 'State', value: 'Disconnected', status: 'critical' }]
  const stateLabel = { connecting: 'Connecting', connected: 'Connected', degraded: 'Degraded' }[link.state]
  return [
    { label: 'State', value: stateLabel, status: link.state === 'connected' ? 'good' : 'warning' },
    { label: 'Path', value: link.path === 'direct' ? 'Direct (P2P)' : link.path === 'relayed' ? 'Relayed (TURN)' : DASH },
    { label: 'IP', value: link.ipVersion ? `IPv${link.ipVersion}` : DASH },
    { label: 'Pair', value: link.pairKinds ?? DASH },
    { label: 'Latency', value: num(link.rttMs, 0, 'ms'), status: gradeStatus(gradeHigherWorse(link.rttMs, THRESHOLDS.rttMs)) },
    { label: 'Jitter', value: num(link.jitterMs, 0, 'ms'), status: gradeStatus(gradeHigherWorse(link.jitterMs, THRESHOLDS.jitterMs)) },
  ]
}

export function videoRows(link: LinkStatus | null): DrawerRow[] {
  const freezes =
    link?.videoFreezeCount === undefined
      ? DASH
      : `${link.videoFreezeCount}${link.videoFreezeSeconds ? ` · ${link.videoFreezeSeconds.toFixed(1)} s` : ''}`
  return [
    { label: 'Frame rate', value: num(link?.videoFps, 0, 'fps'), status: gradeStatus(gradeLowerWorse(link?.videoFps, THRESHOLDS.videoFps)) },
    { label: 'Bitrate', value: num(link?.videoKbps, 0, 'kbps') },
    {
      label: 'Packet loss',
      value: num(link?.packetLossPct, 1, '%'),
      status: gradeStatus(gradeHigherWorse(link?.packetLossPct, THRESHOLDS.packetLossPct)),
    },
    { label: 'Freezes', value: freezes },
  ]
}

export function modeRows(v: VehicleState): DrawerRow[] {
  const { missionProgress: p, rc } = v
  return [
    { label: 'Meaning', value: MODE_MEANING[v.flightMode] },
    { label: 'RC switch', value: rc.modeSwitch ?? DASH },
    { label: 'RC link', value: rc.linked ? 'Linked' : 'Lost', status: rc.linked ? undefined : 'warning' },
    { label: 'Override', value: rc.overrideActive ? 'Pilot has control' : 'No', status: rc.overrideActive ? 'warning' : undefined },
    { label: 'Mission item', value: p.total > 0 ? `${Math.min(p.currentIndex + 1, p.total)} of ${p.total}` : DASH },
  ]
}

export function armedRows(v: VehicleState): DrawerRow[] {
  const active = (Object.keys(FAILSAFE_LABEL) as (keyof FailsafeFlags)[]).filter((k) => v.failsafe[k])
  return [
    { label: 'Motors', value: v.armed ? 'Armed' : 'Disarmed', status: v.armed ? 'warning' : undefined },
    { label: 'On ground', value: v.landed ? 'Landed' : 'Airborne' },
    {
      label: 'Failsafes',
      value: active.length > 0 ? active.map((k) => FAILSAFE_LABEL[k]).join(', ') : 'None',
      status: active.length > 0 ? 'critical' : 'good',
    },
    { label: 'Home', value: v.home ? 'Set' : 'Not set', status: v.home ? undefined : 'warning' },
  ]
}

export function vtolRows(v: VehicleState): DrawerRow[] {
  const flying = { mc: 'Multicopter (hover)', fw: 'Fixed-wing', transition: 'Transitioning' }[v.vtolState]
  return [
    { label: 'Flying as', value: flying },
    { label: 'Airspeed', value: num(v.airspeedMps, 1, 'm/s') },
    { label: 'Climb', value: signed(v.climbMps, 1, 'm/s') },
  ]
}

export function altitudeRows(v: VehicleState): DrawerRow[] {
  return [
    { label: 'Above home', value: num(v.position.altRelM, 1, 'm') },
    { label: 'Above sea', value: num(v.position.altAmslM, 1, 'm') },
    { label: 'Home elev.', value: v.home ? num(v.home.altAmslM, 0, 'm') : DASH },
    { label: 'Climb', value: signed(v.climbMps, 1, 'm/s') },
  ]
}

export function speedRows(v: VehicleState): DrawerRow[] {
  return [
    { label: 'Ground', value: `${num(v.groundSpeedMps, 1, 'm/s')} · ${(v.groundSpeedMps * 3.6).toFixed(0)} km/h` },
    { label: 'Airspeed', value: num(v.airspeedMps, 1, 'm/s') },
    { label: 'Vertical', value: signed(v.climbMps, 1, 'm/s') },
  ]
}

export function headingRows(v: VehicleState): DrawerRow[] {
  const { yawDeg, rollDeg, pitchDeg } = v.attitude
  return [
    { label: 'Heading', value: `${formatHeadingDeg(yawDeg)} ${compassPoint(yawDeg)}` },
    { label: 'Roll', value: signed(rollDeg, 0, '°') },
    { label: 'Pitch', value: signed(pitchDeg, 0, '°') },
  ]
}

/** Within this much of the return-home figure, it's flagged as close. */
const BATTERY_RETURN_WARN_PCT = 10

export function batteryRows(v: VehicleState): DrawerRow[] {
  const { percent, voltageV, currentA, toHomePercent } = v.battery
  const spare = toHomePercent === undefined ? undefined : percent - toHomePercent
  return [
    { label: 'Charge', value: num(percent, 0, '%') },
    // The vehicle returns home by itself at this (ADR-0025).
    {
      label: 'Needed to get home',
      value: toHomePercent === undefined ? DASH : `${toHomePercent.toFixed(0)} %`,
      status: spare === undefined ? undefined : spare <= 0 ? 'critical' : spare < BATTERY_RETURN_WARN_PCT ? 'warning' : 'good',
    },
    { label: 'Voltage', value: num(voltageV, 2, 'V') },
    { label: 'Current', value: num(currentA, 1, 'A') },
    { label: 'Power', value: num(voltageV * currentA, 0, 'W') },
  ]
}

export function gpsRows(v: VehicleState): DrawerRow[] {
  const { fixType, satellites, hdop } = v.gps
  return [
    { label: 'Fix', value: gpsFixLabel(fixType), status: gpsStatus(fixType) },
    { label: 'Satellites', value: String(satellites) },
    { label: 'HDOP', value: num(hdop, 1, '').trim() },
    { label: 'Latitude', value: `${v.position.lat.toFixed(5)}°` },
    { label: 'Longitude', value: `${v.position.lon.toFixed(5)}°` },
  ]
}
