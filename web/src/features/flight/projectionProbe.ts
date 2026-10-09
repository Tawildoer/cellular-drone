import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MaplibreMap } from 'maplibre-gl'
import type { GeoPoint } from '../../domain'
import { transform } from './gimbalRayLayer'

export interface ProjectionProbe extends CustomLayerInterface {
  /** Where a point in the air shows on screen (CSS pixels from the map's
   * top-left), as of the last frame drawn. Null before the first frame or
   * behind the camera. */
  project(point: GeoPoint, elevationM: number): { x: number; y: number } | null
}

/**
 * An invisible custom layer that keeps the map's projection from the last
 * frame, so things floating at altitude (the 3D waypoint markers) can be
 * placed on screen: `map.project` only knows the ground. Mercator only, like
 * the flight map. The matrix is copied each frame (16 numbers).
 */
export function createProjectionProbe(id: string, map: MaplibreMap): ProjectionProbe {
  let matrix: number[] | null = null

  return {
    id,
    type: 'custom',
    renderingMode: '3d',
    render(_gl, args: CustomRenderMethodInput) {
      matrix = Array.from(args.defaultProjectionData.mainMatrix)
    },
    project(point, elevationM) {
      if (!matrix) return null
      const c = MercatorCoordinate.fromLngLat([point.lon, point.lat], elevationM)
      const [x, y, , w] = transform(matrix, c.x, c.y, c.z)
      if (w <= 1e-6) return null
      const canvas = map.getCanvas()
      return { x: ((x / w + 1) / 2) * canvas.clientWidth, y: ((1 - y / w) / 2) * canvas.clientHeight }
    },
  }
}
