import { useMemo } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useVehicleStore } from '../../app/store-hooks'
import { routeBattery, validateMission, type Mission } from '../../domain'
import { useRouteWind } from '../flight/forecastWind'
import { RouteBatteryNote } from './RouteBatteryNote'

export function MissionValidationPanel({ mission }: { mission: Mission }) {
  const result = validateMission(mission)
  // By value (telemetry hands over new objects every update), and the
  // charge to the whole percent so it doesn't re-render ten times a second.
  const homeLat = useVehicleStore((s) => s.vehicleState?.home?.lat)
  const homeLon = useVehicleStore((s) => s.vehicleState?.home?.lon)
  const chargePct = useVehicleStore((s) => (s.vehicleState ? Math.round(s.vehicleState.battery.percent) : null))
  const wind = useRouteWind()
  // Not connected: planned against a full battery.
  const battery = useMemo(
    () =>
      homeLat !== undefined && homeLon !== undefined && mission.items.length > 1
        ? routeBattery(mission, { lat: homeLat, lon: homeLon }, chargePct ?? 100, { wind })
        : null,
    [mission, homeLat, homeLon, chargePct, wind],
  )

  return (
    <div className="glass-panel flex max-w-xs flex-col gap-1.5 px-2.5 py-1.5">
      <div className="flex items-center gap-1.5">
        {result.valid ? (
          <CheckCircle2 size={12} style={{ color: 'var(--status-good)' }} aria-hidden />
        ) : (
          <XCircle size={12} style={{ color: 'var(--status-critical)' }} aria-hidden />
        )}
        <span className="hud-label" style={{ color: result.valid ? 'var(--status-good)' : 'var(--status-critical)' }}>
          {result.valid ? 'Mission valid' : `${result.issues.length} issue${result.issues.length === 1 ? '' : 's'}`}
        </span>
      </div>
      {battery && <RouteBatteryNote battery={battery} subject="This mission" />}
      {!result.valid && (
        <ul className="flex flex-col gap-1">
          {result.issues.map((issue, i) => (
            <li key={i} className="text-xs" style={{ color: 'var(--status-critical)' }}>
              {issue.itemIndex !== null ? `Item ${issue.itemIndex + 1}: ` : ''}
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
