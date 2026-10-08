import { describe, expect, it } from 'vitest'
import { decodeTerrainRgb, pixelIndex, tilePosition } from '../MapTilerTerrainService'

describe('terrain tiles', () => {
  it('decodes Terrain-RGB', () => {
    expect(decodeTerrainRgb(1, 134, 160)).toBeCloseTo(0, 5) // (65536 + 34464) · 0.1 = 10000
    expect(decodeTerrainRgb(1, 136, 148)).toBeCloseTo(50, 5)
  })

  it('finds the slippy-map tile for a point', () => {
    // Null Island sits on the corner of the four central tiles.
    expect(tilePosition({ lat: 0, lon: 0 }, 1)).toMatchObject({ x: 1, y: 1, u: 0, v: 0 })
    const melbourne = tilePosition({ lat: -37.861, lon: 145.062 }, 12)
    expect(melbourne.x).toBe(3698)
    expect(melbourne.y).toBe(2514)
    expect(melbourne.u).toBeGreaterThanOrEqual(0)
    expect(melbourne.u).toBeLessThan(1)
  })

  it('indexes pixels row-major and clamps to the tile', () => {
    expect(pixelIndex(0, 0, 256)).toBe(0)
    expect(pixelIndex(0.5, 0.5, 256)).toBe(128 * 256 + 128)
    expect(pixelIndex(1, 1, 256)).toBe(255 * 256 + 255)
  })
})
