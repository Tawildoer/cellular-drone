import { useState } from 'react'
import { BatteryWarning } from 'lucide-react'
import { useVehicleStore, useVehicleStoreApi } from '../../app/store-hooks'
import { HoldToConfirmButton } from '../../components/HoldToConfirmButton'

/** Within this much battery of what getting home needs, the operator is
 * asked to turn round (matches the battery drawer's amber). */
const WARN_SPARE_PCT = 10
/** After "Keep flying", ask again once the spare has fallen this much more. */
const REWARN_DROP_PCT = 5

/**
 * The battery is nearly down to what the trip home needs (ADR-0025): a
 * screen-filling warning asking the operator to turn round now, rather than
 * leave it to the vehicle's own return at the last moment. Returning home is
 * a mode change, so it's hold-to-confirm. "Keep flying" puts it away until
 * the spare has dropped another REWARN_DROP_PCT. Gone once the aircraft is
 * returning, landing or down.
 */
export function BatteryReturnWarning() {
  const store = useVehicleStoreApi()
  const percent = useVehicleStore((s) => s.vehicleState?.battery.percent)
  const toHome = useVehicleStore((s) => s.vehicleState?.battery.toHomePercent)
  const settled = useVehicleStore((s) => {
    const v = s.vehicleState
    return !v || v.landed || v.flightMode === 'RTL' || v.flightMode === 'QLAND'
  })
  /** The spare when last dismissed; null while not dismissed. */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const spare = percent !== undefined && toHome !== undefined ? percent - toHome : undefined
  // Back above the line (charged, or nearer home): forget the dismissal.
  if (dismissedAt !== null && (spare === undefined || spare >= WARN_SPARE_PCT)) setDismissedAt(null)

  if (settled || spare === undefined || percent === undefined || toHome === undefined) return null
  if (spare >= WARN_SPARE_PCT) return null
  if (dismissedAt !== null && spare > dismissedAt - REWARN_DROP_PCT) return null

  async function returnHome() {
    const result = await store.getState().send({ type: 'mode.rtl' })
    setError(result.ok ? null : `RTL didn't go through: ${result.detail ?? result.reason}`)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="battery-return-title"
        aria-describedby="battery-return-detail"
        className="glass-panel battery-return-warning flex w-full max-w-lg flex-col items-center gap-4 px-8 py-7 text-center"
      >
        <BatteryWarning size={44} aria-hidden style={{ color: 'var(--status-critical)' }} />
        <h2 id="battery-return-title" className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--status-critical)' }}>
          Battery low: turn around now
        </h2>
        <p id="battery-return-detail" className="text-sm leading-relaxed text-[var(--foreground)]">
          <span className="hud-value text-base" style={{ color: 'var(--status-critical)', textShadow: 'none' }}>
            {Math.round(percent)}%
          </span>{' '}
          left, about{' '}
          <span className="hud-value text-base" style={{ textShadow: 'none' }}>
            {Math.round(toHome)}%
          </span>{' '}
          needed to fly home and land.
          <br />
          {spare > 0
            ? `At ${Math.round(toHome)}% the drone returns home by itself.`
            : 'The drone is returning home by itself.'}
        </p>
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <HoldToConfirmButton
            variant="destructive"
            onConfirm={() => void returnHome()}
            className="battery-return-button flex-1 rounded-lg px-4 py-3 text-base font-semibold text-white"
          >
            Hold to return home
          </HoldToConfirmButton>
          <button
            type="button"
            onClick={() => setDismissedAt(spare)}
            className="rounded-lg px-4 py-3 text-sm text-[var(--muted-foreground)] transition hover:bg-white/10"
          >
            Keep flying
          </button>
        </div>
        {error && (
          <span role="status" className="hud-label" style={{ color: 'var(--status-warning)' }}>
            {error}
          </span>
        )}
      </div>
    </div>
  )
}
