import type { GeoPoint } from '../../domain'
import type { TerrainService } from '../TerrainService'

/** The map's own terrain tiles (FlightMap: `terrain-rgb-v2`, maxzoom 12), so
 * the profile and the 3D ground agree. A z12 tile spans ~10 km: about 30 m
 * a pixel at 256 px, at Melbourne's latitude. */
const ZOOM = 12

export interface TilePosition {
  x: number
  y: number
  /** Where in the tile, 0..1 across and down. */
  u: number
  v: number
}

/** Web Mercator tile for a point (slippy-map tiling), and where in it. */
export function tilePosition(point: GeoPoint, zoom = ZOOM): TilePosition {
  const n = 2 ** zoom
  const latRad = (point.lat * Math.PI) / 180
  const fx = ((point.lon + 180) / 360) * n
  const fy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  const x = Math.floor(fx)
  const y = Math.floor(fy)
  return { x, y, u: fx - x, v: fy - y }
}

/** The pixel at (u, v) in a tile `size` pixels square. */
export function pixelIndex(u: number, v: number, size: number): number {
  const clamp = (p: number) => Math.min(size - 1, Math.max(0, Math.floor(p * size)))
  return clamp(v) * size + clamp(u)
}

/** Terrain-RGB ("mapbox" encoding): metres = -10000 + (R·65536 + G·256 + B) · 0.1. */
export function decodeTerrainRgb(r: number, g: number, b: number): number {
  return -10000 + (r * 65536 + g * 256 + b) * 0.1
}

interface Pixels {
  data: Uint8ClampedArray
  width: number
}

export class MapTilerTerrainService implements TerrainService {
  readonly description = 'MapTiler terrain, ~30 m grid'
  /** Per tile, kept for the session: a mission rarely spans more than a few. */
  private readonly tiles = new Map<string, Promise<Pixels | null>>()

  private readonly apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async elevationsM(points: GeoPoint[], signal?: AbortSignal): Promise<(number | null)[]> {
    const located = points.map((point) => tilePosition(point))
    const tiles = await Promise.all(located.map(({ x, y }) => this.tile(x, y)))
    signal?.throwIfAborted()
    return located.map(({ u, v }, i) => {
      const tile = tiles[i]
      if (!tile) return null
      const o = pixelIndex(u, v, tile.width) * 4
      return decodeTerrainRgb(tile.data[o]!, tile.data[o + 1]!, tile.data[o + 2]!)
    })
  }

  private tile(x: number, y: number): Promise<Pixels | null> {
    const key = `${x}/${y}`
    let tile = this.tiles.get(key)
    if (!tile) {
      tile = this.fetchTile(x, y)
      this.tiles.set(key, tile)
      // A failed tile is retried next time rather than cached as missing.
      void tile.then((t) => t ?? this.tiles.delete(key))
    }
    return tile
  }

  private async fetchTile(x: number, y: number): Promise<Pixels | null> {
    try {
      const url = `https://api.maptiler.com/tiles/terrain-rgb-v2/${ZOOM}/${x}/${y}.webp?key=${this.apiKey}`
      const response = await fetch(url)
      if (!response.ok) return null
      const bitmap = await createImageBitmap(await response.blob())
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')
      if (!context) return null
      context.drawImage(bitmap, 0, 0)
      const { data, width } = context.getImageData(0, 0, bitmap.width, bitmap.height)
      return { data, width }
    } catch {
      return null
    }
  }
}
