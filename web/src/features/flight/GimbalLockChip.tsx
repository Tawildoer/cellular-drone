import { Crosshair } from 'lucide-react'
import { useVehicleStore } from '../../app/store-hooks'

/** While the gimbal is locked onto a spot (ADR-0023): says so, and releases it. */
export function GimbalLockChip({ onRelease }: { onRelease: () => void }) {
  const locked = useVehicleStore((s) => !!s.vehicleState?.gimbal?.lock)
  if (!locked) return null
  return (
    <div role="status" className="glass-panel flex items-center gap-2 py-1 pl-2.5 pr-1">
      <Crosshair size={12} aria-hidden style={{ color: 'var(--primary)' }} />
      <span className="hud-label" style={{ color: 'var(--primary)' }}>
        Gimbal locked
      </span>
      <button
        type="button"
        onClick={onRelease}
        className="rounded-md bg-secondary glass-tile px-2 py-0.5 text-xs font-medium transition hover:bg-white/10"
      >
        Release
      </button>
    </div>
  )
}
