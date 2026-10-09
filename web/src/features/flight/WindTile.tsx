import { ArrowUp } from 'lucide-react'
import { useVehicleStore } from '../../app/store-hooks'
import { HoverDrawer, type DrawerRow } from '../../components/HoverDrawer'
import { headwindMps, WIND_MODERATE_MPS, WIND_STRONG_MPS } from '../../domain'
import { useForecastWind, useMeasuredWind } from './forecastWind'
import { compassPoint } from './hudDetails'

function windStatus(speedMps: number) {
  return speedMps >= WIND_STRONG_MPS ? 'critical' : speedMps >= WIND_MODERATE_MPS ? 'warning' : 'good'
}

/**
 * The wind where the drone is (ADR-0026): what it measures itself when it
 * reports that, otherwise the forecast there. The arrow points downwind with
 * north up; the drawer has the source, gusts and the headwind on its nose.
 */
export function WindTile() {
  const measured = useMeasuredWind()
  const forecast = useForecastWind()
  const headingDeg = useVehicleStore((s) => (s.vehicleState ? Math.round(s.vehicleState.attitude.yawDeg) : null))
  const wind = measured ?? forecast

  const status = wind ? windStatus(wind.speedMps) : undefined
  const color = status ? `var(--status-${status})` : 'var(--text-dim)'
  const head = wind && headingDeg !== null ? headwindMps(headingDeg, wind) : null
  const rows: DrawerRow[] = wind
    ? [
        { label: 'Source', value: measured ? 'Measured by the drone' : `Forecast, ${forecast?.source} at ${forecast?.heightM} m` },
        { label: 'Speed', value: `${wind.speedMps.toFixed(1)} m/s`, status },
        { label: 'From', value: `${Math.round(wind.fromDeg).toString().padStart(3, '0')}° ${compassPoint(wind.fromDeg)}` },
        ...(forecast?.gustMps != null ? [{ label: 'Gusts (10 m)', value: `${forecast.gustMps.toFixed(1)} m/s` }] : []),
        ...(head !== null
          ? [{ label: 'On the nose', value: `${Math.abs(head).toFixed(1)} m/s ${head >= 0 ? 'head' : 'tail'}wind`, status: head >= 7 ? ('warning' as const) : undefined }]
          : []),
        ...(!measured && forecast
          ? [{ label: 'Forecast for', value: new Date(forecast.validAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]
          : []),
      ]
    : [{ label: 'Wind', value: 'Not known yet' }]

  return (
    <HoverDrawer title="Wind" rows={rows} className="flex flex-1">
      <div className="flex h-7 flex-1 items-center justify-center gap-1 overflow-hidden rounded-lg bg-secondary px-1.5 glass-tile" style={{ minWidth: 92 }}>
        <span className="hud-label sr-only">Wind</span>
        <ArrowUp
          size={12}
          aria-hidden
          className="shrink-0 transition-transform"
          style={{ color, transform: wind ? `rotate(${wind.fromDeg + 180}deg)` : undefined }}
        />
        <span className="hud-value whitespace-nowrap" style={status ? { color, textShadow: 'none' } : undefined}>
          {wind ? `${wind.speedMps.toFixed(1)} m/s` : '—'}
        </span>
        {wind && <span className="hud-label whitespace-nowrap text-[0.5625rem]">{compassPoint(wind.fromDeg)}</span>}
      </div>
    </HoverDrawer>
  )
}
