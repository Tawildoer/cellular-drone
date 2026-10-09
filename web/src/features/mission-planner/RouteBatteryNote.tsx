import { BatteryWarning, BatteryFull } from 'lucide-react'
import { BATTERY_RETURN_RESERVE_PCT, type RouteBattery } from '../../domain'

/**
 * Whether a route fits the battery (ADR-0025): red if it's too long for even
 * a full battery, amber if it won't make it on the charge there is, a quiet
 * line otherwise. The figure includes the reserve.
 */
export function RouteBatteryNote({ battery, subject }: { battery: RouteBattery; subject: string }) {
  const needed = Math.round(battery.neededPct)
  const available = Math.round(battery.availablePct)
  const status = !battery.fitsFullBattery ? 'critical' : !battery.fits ? 'warning' : 'good'
  const color = `var(--status-${status})`
  const Icon = status === 'good' ? BatteryFull : BatteryWarning
  return (
    <div role={status === 'good' ? undefined : 'alert'} className="flex items-start gap-1.5">
      <Icon size={12} aria-hidden className="mt-px shrink-0" style={{ color }} />
      <span className="text-xs leading-snug" style={{ color: status === 'good' ? 'var(--muted-foreground)' : color }}>
        {status === 'critical' && `${subject} is too long for one battery: it needs about ${needed}% (incl. ${BATTERY_RETURN_RESERVE_PCT}% reserve).`}
        {status === 'warning' &&
          `Battery may not make it: ${subject.toLowerCase()} needs about ${needed}% (incl. ${BATTERY_RETURN_RESERVE_PCT}% reserve), ${available}% left. The drone will turn for home by itself when it has to.`}
        {status === 'good' && `Battery: ${subject.toLowerCase()} needs about ${needed}% of ${available}%.`}
      </span>
    </div>
  )
}
