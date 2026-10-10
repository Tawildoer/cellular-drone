import { WIND_MODERATE_MPS, WIND_STRONG_MPS } from '../../domain'
import type { WeatherOverlayStatus } from './useWeatherOverlay'

const WIND_KEY = [
  { color: '#ffffff', label: `< ${WIND_MODERATE_MPS}` },
  { color: 'var(--status-warning)', label: `${WIND_MODERATE_MPS}–${WIND_STRONG_MPS}` },
  { color: 'var(--status-critical)', label: `> ${WIND_STRONG_MPS}` },
]

/** The wind overlay's colour key (ADR-0026), and whether it's loading or
 * unavailable. The rain overlay has none. */
export function WeatherLegend({ status }: { status: WeatherOverlayStatus }) {
  return (
    <div className="glass-panel flex flex-col gap-1 self-stretch px-2.5 py-1.5" role="status" aria-live="polite">
      <span className="hud-label" style={{ color: 'var(--primary)' }}>
        Wind{status.kind === 'ready' && status.heightM ? ` at ${status.heightM} m` : ''}
      </span>
      <div className="flex flex-col gap-0.5">
        {WIND_KEY.map((k) => (
          <span key={k.label} className="flex items-center gap-1.5 text-[0.6875rem]">
            <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: k.color }} />
            {k.label}
          </span>
        ))}
      </div>
      {status.kind === 'loading' && <span className="hud-label text-[0.5625rem]">Loading…</span>}
      {status.kind === 'error' && (
        <span className="text-[0.625rem]" style={{ color: 'var(--status-warning)' }}>
          {status.message}
        </span>
      )}
    </div>
  )
}
