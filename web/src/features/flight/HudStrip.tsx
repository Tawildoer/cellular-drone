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
    // A single row in the top bar, each metric its own fixed-width tile:
    // widths measured in the browser at each one's longest value (e.g. 'No
    // link', 'QLOITER', '99.9 m/s', '2D fix 99 sats'), so nothing shifts as
    // values change. Re-measure if a label or format changes.
    // Slightly tighter letter spacing than the HUD default, to fit at 1280 px.
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto [&_.hud-label]:tracking-[0.06em] [&_.hud-value]:tracking-[0.03em]">
      <StatTile width={121} label="Link" value={link.label} detail={link.detail} icon={Radio} status={link.status} hideLabel />
      <LinkStrengthTile />
      <StatTile width={93} label="Flight mode" shortLabel="Mode" value={vehicleState.flightMode} />
      <StatTile
        width={89}
        label="Armed"
        value={vehicleState.armed ? 'Armed' : 'Disarmed'}
        icon={vehicleState.armed ? ShieldAlert : ShieldCheck}
        status={vehicleState.armed ? 'warning' : undefined}
        hideLabel
      />
      <StatTile width={78} label="VTOL state" shortLabel="VTOL" value={vtolStateLabel(vehicleState.vtolState)} />
      <StatTile width={80} label="Altitude AGL" shortLabel="Alt" value={`${Math.round(vehicleState.position.altRelM)} m`} />
      <StatTile width={95} label="Ground speed" shortLabel="Spd" value={`${vehicleState.groundSpeedMps.toFixed(1)} m/s`} />
      <StatTile width={65} label="Heading" shortLabel="Hdg" value={formatHeadingDeg(vehicleState.attitude.yawDeg)} />
      <StatTile
        width={98}
        label="Battery"
        value={`${Math.round(vehicleState.battery.percent)}%`}
        detail={`${vehicleState.battery.voltageV.toFixed(1)} V`}
        icon={BatteryIcon}
        status={batteryStatus(vehicleState.battery.percent)}
        hideLabel
      />
      <StatTile
        width={119}
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
