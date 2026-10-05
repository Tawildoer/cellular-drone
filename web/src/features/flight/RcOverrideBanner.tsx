import { Radio } from 'lucide-react'
import { useVehicleStore } from '../../app/store-hooks'

/** Always visible when RC override is active (docs/FRONTEND.md, ADR-0008) —
 * the physical radio has taken control and browser commands are refused. */
export function RcOverrideBanner() {
  const overrideActive = useVehicleStore((s) => s.vehicleState?.rc.overrideActive ?? false)

  if (!overrideActive) return null

  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-lg border px-3 py-2"
      style={{ borderColor: 'var(--status-warning)', background: 'color-mix(in srgb, var(--status-warning) 15%, transparent)' }}
    >
      <Radio size={16} style={{ color: 'var(--status-warning)' }} aria-hidden />
      <span className="hud-value" style={{ color: 'var(--status-warning)', textShadow: 'none' }}>
        RC override active — physical radio has control, browser commands are blocked
      </span>
    </div>
  )
}
