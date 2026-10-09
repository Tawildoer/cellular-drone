import type { GeoPoint, RadarFrame, WindField, WindSample } from '../../domain'
import type { WeatherService } from '../WeatherService'

/** Open-Meteo's height nearest the flying heights (60 m above home). */
const WIND_HEIGHT_M = 80
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'
const RAINVIEWER_URL = 'https://api.rainviewer.com/public/weather-maps.json'
/** RainViewer's free tiles stop here; the map enlarges them beyond. */
const RAINVIEWER_MAX_ZOOM = 7

interface OpenMeteoPoint {
  current?: { wind_gusts_10m?: number | null }
  hourly?: { time: string[]; wind_speed_80m: (number | null)[]; wind_direction_80m: (number | null)[] }
}

interface RainViewerMaps {
  host: string
  radar?: { past?: { time: number; path: string }[] }
}

/**
 * Free public sources, no key (ADR-0026): wind from Open-Meteo (forecast
 * models, hourly at 80 m; gusts at 10 m now), rain radar from RainViewer.
 * The browser asks them directly with the map's area: nothing about the
 * drone goes with it.
 */
export class PublicWeatherService implements WeatherService {
  readonly windSource = 'Open-Meteo'
  readonly radarSource = 'RainViewer'

  async wind(points: GeoPoint[], signal?: AbortSignal): Promise<WindField> {
    const params = new URLSearchParams({
      latitude: points.map((p) => p.lat.toFixed(4)).join(','),
      longitude: points.map((p) => p.lon.toFixed(4)).join(','),
      current: 'wind_gusts_10m',
      hourly: 'wind_speed_80m,wind_direction_80m',
      forecast_hours: '1',
      wind_speed_unit: 'ms',
      timezone: 'GMT',
    })
    const res = await fetch(`${OPEN_METEO_URL}?${params}`, { signal })
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
    const body = (await res.json()) as OpenMeteoPoint | OpenMeteoPoint[]
    const results = Array.isArray(body) ? body : [body]
    let validAtMs = Date.now()
    const samples: WindSample[] = []
    results.forEach((r, i) => {
      const speed = r.hourly?.wind_speed_80m[0]
      const from = r.hourly?.wind_direction_80m[0]
      const time = r.hourly?.time[0]
      if (speed == null || from == null || !points[i]) return
      if (time) validAtMs = Date.parse(`${time}:00Z`)
      samples.push({ point: points[i], speedMps: speed, fromDeg: from, gustMps: r.current?.wind_gusts_10m ?? null })
    })
    return { samples, heightM: WIND_HEIGHT_M, validAtMs }
  }

  async latestRadar(signal?: AbortSignal): Promise<RadarFrame | null> {
    const res = await fetch(RAINVIEWER_URL, { signal })
    if (!res.ok) throw new Error(`RainViewer ${res.status}`)
    const maps = (await res.json()) as RainViewerMaps
    const latest = maps.radar?.past?.at(-1)
    if (!latest) return null
    // 256 px tiles, colour scheme 2 (universal blue), smoothed, with snow.
    return { tileUrl: `${maps.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`, timeMs: latest.time * 1000, maxZoom: RAINVIEWER_MAX_ZOOM }
  }
}
