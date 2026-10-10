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

describe('mock link conditions with a poor signal', () => {
  it('have a longer round trip and more loss at low SINR', () => {
    const mean = (sinrDb: number | undefined) => {
      const rng = seeded(7)
      let c = INITIAL_LINK_CONDITIONS
      let rtt = 0
      let loss = 0
      for (let i = 0; i < 10_000; i++) {
        c = nextLinkConditions(c, 0.1, rng, sinrDb)
        rtt += c.rttMs
        loss += c.packetLossPct
      }
      return { rtt: rtt / 10_000, loss: loss / 10_000 }
    }
    const good = mean(15)
    const poor = mean(-2)
    expect(poor.rtt).toBeGreaterThan(good.rtt + 50)
    expect(poor.loss).toBeGreaterThan(good.loss)
    expect(mean(undefined).rtt).toBeCloseTo(good.rtt, 0)
  })
})
