import { describe, expect, it } from 'vitest'
import { INITIAL_LINK_CONDITIONS, nextLinkConditions } from '../linkConditions'

/** Deterministic pseudo-random numbers in [0, 1). */
function seeded(seed: number): () => number {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

describe('mock link conditions', () => {
  it('wander within realistic bounds over a long run', () => {
    const rng = seeded(42)
    let c = INITIAL_LINK_CONDITIONS
    const rtts: number[] = []
    for (let i = 0; i < 20_000; i++) {
      c = nextLinkConditions(c, 0.1, rng)
      rtts.push(c.rttMs)
      expect(c.rttMs).toBeGreaterThanOrEqual(25)
      expect(c.videoFps).toBeGreaterThanOrEqual(5)
      expect(c.videoFps).toBeLessThanOrEqual(30)
      expect(c.packetLossPct).toBeGreaterThanOrEqual(0)
    }
    const mean = rtts.reduce((a, b) => a + b, 0) / rtts.length
    expect(mean).toBeGreaterThan(50)
    expect(mean).toBeLessThan(120)
    // It moves, and now and then it spikes.
    expect(Math.max(...rtts)).toBeGreaterThan(200)
  })
})
