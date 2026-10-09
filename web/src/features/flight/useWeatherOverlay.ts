import { useEffect, useState } from 'react'
import type { Map as MaplibreMap, RasterTileSource } from 'maplibre-gl'
import { fromLocalEastNorthM, gridPoints } from '../../domain'
import type { WeatherService } from '../../services'
import { metersPerPixel } from './flightMapGeo'
import { buildWindGrid, type WindGrid } from './weatherOverlay'

export type WeatherOverlay = 'none' | 'wind' | 'rain'

export type WeatherOverlayStatus =
  | { kind: 'off' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; source: string; validAtMs: number; heightM?: number }

const RAIN_SOURCE = 'weather-rain'
const RAIN_LAYER = 'weather-rain'
const RAIN_OPACITY = 0.65
/** Forecasts and radar update every 10 minutes or so. */
const REFRESH_MS = 10 * 60_000
/** After the map stops moving, wait this long before fetching wind for it. */
const MOVE_SETTLE_MS = 600
/** Wind samples across the view, and how far past it they reach. */
const WIND_COLS = 8
const WIND_MARGIN = 1.3

/**
 * The map's weather overlay (ADR-0026): wind sampled on a grid over the view
 * (fetched again when the view settles, and every 10 minutes) for the wind
 * streaks to flow through, or the latest rain-radar tiles, added under
 * `beforeId` (the flight overlays stay on top) and removed when switched
 * off. Returns what the legend shows, and the wind grid.
 */
export function useWeatherOverlay(
  map: MaplibreMap | null,
  overlay: WeatherOverlay,
  service: WeatherService | null,
  beforeId?: string,
): { status: WeatherOverlayStatus; windGrid: WindGrid | null } {
  // Results are kept with the overlay they're for: until the one shown has
  // its own, it's loading.
  const [result, setResult] = useState<{ overlay: WeatherOverlay; status: WeatherOverlayStatus } | null>(null)
  const [windGrid, setWindGrid] = useState<WindGrid | null>(null)

  useEffect(() => {
    if (!map || !service || overlay === 'none') return
    let aborter: AbortController | null = null
    let settleTimer: number | undefined
    const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined
    const setStatus = (status: WeatherOverlayStatus) => setResult({ overlay, status })

    async function loadWind() {
      if (!map || !service) return
      aborter?.abort()
      aborter = new AbortController()
      // Around the centre at its scale, with a margin so streaks flowing in
      // from off screen have wind: a tilted map's bounds run to the horizon.
      const center = map.getCenter()
      const mpp = metersPerPixel(map.getZoom(), center.lat)
      const { clientWidth: w, clientHeight: h } = map.getContainer()
      const halfW = (w * mpp * WIND_MARGIN) / 2
      const halfH = (h * mpp * WIND_MARGIN) / 2
      const sw = fromLocalEastNorthM({ lat: center.lat, lon: center.lng }, -halfW, -halfH)
      const ne = fromLocalEastNorthM({ lat: center.lat, lon: center.lng }, halfW, halfH)
      const rows = Math.max(3, Math.min(8, Math.round((WIND_COLS * h) / w)))
      try {
        const field = await service.wind(gridPoints(sw.lat, sw.lon, ne.lat, ne.lon, WIND_COLS, rows), aborter.signal)
        setWindGrid(buildWindGrid(field.samples, sw.lat, sw.lon, ne.lat, ne.lon, WIND_COLS, rows))
        setStatus({ kind: 'ready', source: service.windSource, validAtMs: field.validAtMs, heightM: field.heightM })
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setStatus({ kind: 'error', message: `Wind unavailable (${(e as Error).message})` })
      }
    }

    async function loadRain() {
      if (!map || !service) return
      aborter?.abort()
      aborter = new AbortController()
      try {
        const frame = await service.latestRadar(aborter.signal)
        if (!frame) {
          setStatus({ kind: 'error', message: 'No radar frame available' })
          return
        }
        const source = map.getSource(RAIN_SOURCE) as RasterTileSource | undefined
        if (source) source.setTiles([frame.tileUrl])
        else {
          map.addSource(RAIN_SOURCE, { type: 'raster', tiles: [frame.tileUrl], tileSize: 256, maxzoom: frame.maxZoom })
          map.addLayer({ id: RAIN_LAYER, type: 'raster', source: RAIN_SOURCE, paint: { 'raster-opacity': RAIN_OPACITY } }, before)
        }
        setStatus({ kind: 'ready', source: service.radarSource, validAtMs: frame.timeMs })
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setStatus({ kind: 'error', message: `Radar unavailable (${(e as Error).message})` })
      }
    }

    const load = overlay === 'wind' ? loadWind : loadRain
    void load()
    const refresh = window.setInterval(() => void load(), REFRESH_MS)
    // Wind is sampled over the view, so a new view needs new samples.
    const onMoveEnd = () => {
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => void loadWind(), MOVE_SETTLE_MS)
    }
    if (overlay === 'wind') map.on('moveend', onMoveEnd)

    return () => {
      aborter?.abort()
      window.clearInterval(refresh)
      window.clearTimeout(settleTimer)
      map.off('moveend', onMoveEnd)
      try {
        if (map.getLayer(RAIN_LAYER)) map.removeLayer(RAIN_LAYER)
        if (map.getSource(RAIN_SOURCE)) map.removeSource(RAIN_SOURCE)
      } catch {
        // The map is already gone (unmounting): nothing left to tidy.
      }
    }
  }, [map, overlay, service, beforeId])

  if (!map || !service || overlay === 'none') return { status: { kind: 'off' }, windGrid: null }
  const status: WeatherOverlayStatus = result?.overlay === overlay ? result.status : { kind: 'loading' }
  return { status, windGrid: overlay === 'wind' ? windGrid : null }
}
