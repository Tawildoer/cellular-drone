import { Radio, ShieldAlert, ShieldCheck, Satellite } from 'lucide-react'
import { useVehicleStore } from '../../app/store-hooks'
import { StatTile } from '../../components/StatTile'
import { batteryIcon, batteryStatus, formatHeadingDeg, gpsFixLabel, gpsStatus, vtolStateLabel } from './hudFormat'
import { formatLinkBadge } from './linkFormat'
import { LinkStrengthTile } from './LinkStrengthTile'

export function HudStrip() {
  const vehicleState = useVehicleStore((s) => s.vehicleState)
  const linkStatus = useVehicleStore((s) => s.linkStatus)

  if (!vehicleState) {
    return (
      <div className="flex items-center px-2.5">
        <span className="hud-label">Waiting for telemetry…</span>
      </div>
    )
  }

  const BatteryIcon = batteryIcon(vehicleState.battery.percent)
  const link = formatLinkBadge(linkStatus)

  return (
    // A single row in the top bar, metrics divided by hairlines.
    <div className="flex min-w-0 items-center divide-x divide-border/60 overflow-x-auto">
      <StatTile label="Link" value={link.label} detail={link.detail} icon={Radio} status={link.status} hideLabel />
      <LinkStrengthTile />
      <StatTile label="Flight mode" shortLabel="Mode" value={vehicleState.flightMode} />
      <StatTile
        label="Armed"
        value={vehicleState.armed ? 'Armed' : 'Disarmed'}
        icon={vehicleState.armed ? ShieldAlert : ShieldCheck}
        status={vehicleState.armed ? 'warning' : undefined}
        hideLabel
      />
      <StatTile label="VTOL state" shortLabel="VTOL" value={vtolStateLabel(vehicleState.vtolState)} />
      <StatTile label="Altitude AGL" shortLabel="Alt" value={`${Math.round(vehicleState.position.altRelM)} m`} />
      <StatTile label="Ground speed" shortLabel="Spd" value={`${vehicleState.groundSpeedMps.toFixed(1)} m/s`} />
      <StatTile label="Heading" shortLabel="Hdg" value={formatHeadingDeg(vehicleState.attitude.yawDeg)} />
      <StatTile
        label="Battery"
        value={`${Math.round(vehicleState.battery.percent)}%`}
        detail={`${vehicleState.battery.voltageV.toFixed(1)} V`}
        icon={BatteryIcon}
        status={batteryStatus(vehicleState.battery.percent)}
        hideLabel
      />
      <StatTile
        label="GPS"
        value={gpsFixLabel(vehicleState.gps.fixType)}
        detail={`${vehicleState.gps.satellites} sats`}
        icon={Satellite}
        status={gpsStatus(vehicleState.gps.fixType)}
        hideLabel
      />
    </div>
  )
}
