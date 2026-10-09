import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useVehicleStore, useWeatherService } from '../../app/store-hooks'
import type { GeoPoint, WindVector } from '../../domain'

/** The forecast wind near the drone (ADR-0026). */
export interface ForecastWind extends WindVector {
  gustMps: number | null
  heightM: number
  validAtMs: number
  source: string
}

const ForecastWindContext = createContext<ForecastWind | null>(null)

/** Forecasts update hourly; this keeps up without asking too often. */
const REFRESH_MS = 10 * 60_000

/** Rounded to about 2 km, as a string: a new forecast only once the place
 * has really changed, not on every telemetry update. */
function placeKey(point: GeoPoint | null | undefined): string | null {
  return point ? `${point.lat.toFixed(2)},${point.lon.toFixed(2)}` : null
}

/**
 * Fetches the forecast wind for the flight screen once, near the drone (or
 * its home, or `fallback`, e.g. the mission, with no drone), for the wind
 * tile, the route's headwind tint and the battery estimates.
 */
export function ForecastWindProvider({ fallback, children }: { fallback: GeoPoint | null; children: ReactNode }) {
  const service = useWeatherService()
  const droneKey = useVehicleStore((s) => {
    const v = s.vehicleState
    return placeKey(v && (v.position.lat !== 0 || v.position.lon !== 0) ? v.position : v?.home)
  })
  const key = droneKey ?? placeKey(fallback)
  const [wind, setWind] = useState<ForecastWind | null>(null)

  useEffect(() => {
    if (!service || !key) return
    const [lat = 0, lon = 0] = key.split(',').map(Number)
    const aborter = new AbortController()
    const load = async () => {
      try {
        const field = await service.wind([{ lat, lon }], aborter.signal)
        const s = field.samples[0]
        if (s) {
          setWind({ speedMps: s.speedMps, fromDeg: s.fromDeg, gustMps: s.gustMps, heightM: field.heightM, validAtMs: field.validAtMs, source: service.windSource })
        }
      } catch {
        // Keep the last forecast; the next refresh tries again.
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    return () => {
      aborter.abort()
      window.clearInterval(timer)
    }
  }, [service, key])

  return <ForecastWindContext.Provider value={wind}>{children}</ForecastWindContext.Provider>
}

export function useForecastWind(): ForecastWind | null {
  return useContext(ForecastWindContext)
}

/** The aircraft's own wind estimate, if it reports one: by value, to a
 * tenth of a m/s and a degree, so it doesn't re-render on every update. */
export function useMeasuredWind(): WindVector | null {
  const key = useVehicleStore((s) => {
    const w = s.vehicleState?.wind
    return w ? `${w.speedMps.toFixed(1)}|${w.fromDeg.toFixed(0)}` : null
  })
  return useMemo(() => {
    if (!key) return null
    const [speedMps = 0, fromDeg = 0] = key.split('|').map(Number)
    return { speedMps, fromDeg }
  }, [key])
}

/** The wind to plan with: what the aircraft measures, else the forecast. */
export function useRouteWind(): WindVector | null {
  const measured = useMeasuredWind()
  const forecast = useForecastWind()
  return useMemo(() => measured ?? (forecast ? { speedMps: forecast.speedMps, fromDeg: forecast.fromDeg } : null), [measured, forecast])
}
