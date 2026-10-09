import type { GeoPoint, RadarFrame, WindField } from '../domain'

/**
 * Weather for the map overlays (ADR-0026). UI code only sees this interface;
 * app/config picks the source.
 */
export interface WeatherService {
  /** For the legend, e.g. "Open-Meteo". */
  readonly windSource: string
  readonly radarSource: string
  /** Wind near flying height at each point, now. */
  wind(points: GeoPoint[], signal?: AbortSignal): Promise<WindField>
  /** The latest rain-radar frame, or null if there's none. */
  latestRadar(signal?: AbortSignal): Promise<RadarFrame | null>
}
