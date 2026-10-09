import { XCircle } from 'lucide-react'
import { useVehicleStore } from '../../app/store-hooks'
import { evaluatePreflight, type Mission } from '../../domain'

/** Only the outstanding (not-yet-passed) checks are worth an operator's
 * attention: once every check passes there's nothing to act on, so it
 * disappears rather than lingering as a wall of green checks. One tile in
 * the bottom bar listing what's left to fix. */
export function PreflightChecklist({ mission }: { mission: Mission | null }) {
  const vehicleState = useVehicleStore((s) => s.vehicleState)

  if (!vehicleState) {
    return (
      <div className="flex h-8 shrink-0 items-center rounded-lg bg-secondary glass-tile px-3">
        <span className="hud-label">Preflight — waiting for telemetry…</span>
      </div>
    )
  }

  const result = evaluatePreflight(vehicleState, mission)
  if (result.ready) return null

  const failedItems = result.items.filter((item) => !item.passed)

  return (
    <div
      className="flex h-8 min-w-0 shrink items-center gap-2 overflow-hidden rounded-lg bg-secondary glass-tile px-3"
      title={failedItems.map((item) => item.label).join('\n')}
    >
      <span className="hud-label shrink-0" style={{ color: 'var(--status-warning)' }}>
        Preflight not ready
      </span>
      {failedItems.map((item) => (
        <span key={item.id} className="flex shrink-0 items-center gap-1">
          <XCircle size={11} style={{ color: 'var(--status-critical)' }} aria-hidden />
          <span className="hud-label whitespace-nowrap text-[0.5625rem]">{item.label}</span>
        </span>
      ))}
    </div>
  )
}
