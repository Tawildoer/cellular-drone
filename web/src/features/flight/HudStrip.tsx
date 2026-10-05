import { Radio, ShieldAlert, ShieldCheck, Satellite } from 'lucide-react'
import { useVehicleStore } from '../../app/store-hooks'
import { StatTile } from '../../components/StatTile'
import { batteryIcon, batteryStatus, formatHeadingDeg, gpsFixLabel, gpsStatus, vtolStateLabel } from './hudFormat'
import { formatLinkBadge } from './linkFormat'

export function HudStrip() {
  const vehicleState = useVehicleStore((s) => s.vehicleState)
  const linkStatus = useVehicleStore((s) => s.linkStatus)

  if (!vehicleState) {
    return (
      <div className="glass-panel px-4 py-3">
        <span className="hud-label">Waiting for telemetry…</span>
      </div>
    )
  }

  const BatteryIcon = batteryIcon(vehicleState.battery.percent)
  const link = formatLinkBadge(linkStatus)

  return (
    <div className="glass-panel flex gap-1.5 overflow-x-auto px-2 py-2">
      <StatTile label="Link" value={link.label} detail={link.detail} icon={Radio} status={link.status} />
      <StatTile label="Flight mode" value={vehicleState.flightMode} />
      <StatTile
        label="Armed"
        value={vehicleState.armed ? 'Armed' : 'Disarmed'}
        icon={vehicleState.armed ? ShieldAlert : ShieldCheck}
        status={vehicleState.armed ? 'warning' : undefined}
      />
      <StatTile label="VTOL state" value={vtolStateLabel(vehicleState.vtolState)} />
      <StatTile label="Altitude AGL" value={`${Math.round(vehicleState.position.altRelM)} m`} />
      <StatTile label="Ground speed" value={`${vehicleState.groundSpeedMps.toFixed(1)} m/s`} />
      <StatTile label="Heading" value={formatHeadingDeg(vehicleState.attitude.yawDeg)} />
      <StatTile
        label="Battery"
        value={`${Math.round(vehicleState.battery.percent)}%`}
        detail={`${vehicleState.battery.voltageV.toFixed(1)} V`}
        icon={BatteryIcon}
        status={batteryStatus(vehicleState.battery.percent)}
      />
      <StatTile
        label="GPS"
        value={gpsFixLabel(vehicleState.gps.fixType)}
        detail={`${vehicleState.gps.satellites} sats`}
        icon={Satellite}
        status={gpsStatus(vehicleState.gps.fixType)}
      />
    </div>
  )
}
