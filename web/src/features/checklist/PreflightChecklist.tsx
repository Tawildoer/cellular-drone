import { XCircle } from 'lucide-react'
import { useVehicleStore } from '../../app/store-hooks'
import { evaluatePreflight, type Mission } from '../../domain'

/** Only the outstanding (not-yet-passed) checks are worth an operator's
 * attention — once every check passes there's nothing to act on, so the
 * whole panel disappears rather than lingering as a wall of green checks. */
export function PreflightChecklist({ mission }: { mission: Mission | null }) {
  const vehicleState = useVehicleStore((s) => s.vehicleState)

  if (!vehicleState) {
    return (
      <div className="glass-panel px-3 py-2">
        <span className="hud-label">Preflight — waiting for telemetry…</span>
      </div>
    )
  }

  const result = evaluatePreflight(vehicleState, mission)
  if (result.ready) return null

  const failedItems = result.items.filter((item) => !item.passed)

  return (
    <div className="glass-panel flex flex-wrap items-center gap-2 px-2.5 py-1.5">
      <span className="hud-label" style={{ color: 'var(--status-warning)' }}>
        Preflight not ready
      </span>
      <div className="flex flex-wrap gap-2">
        {failedItems.map((item) => (
          <span key={item.id} className="flex items-center gap-1">
            <XCircle size={11} style={{ color: 'var(--status-critical)' }} aria-hidden />
            <span className="hud-label text-[0.5625rem]">{item.label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
