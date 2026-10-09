import { describe, expect, it } from 'vitest'
import { isStale, TELEMETRY_STALE_MS, telemetryAgeMs } from '../telemetryAge'

describe('telemetry age', () => {
  it('is null before any telemetry, and never negative', () => {
    expect(telemetryAgeMs(null, 1000)).toBeNull()
    expect(telemetryAgeMs(2000, 1000)).toBe(0)
    expect(telemetryAgeMs(1000, 1500)).toBe(500)
  })

  it('goes stale at the threshold', () => {
    expect(isStale(null)).toBe(false)
    expect(isStale(TELEMETRY_STALE_MS - 1)).toBe(false)
    expect(isStale(TELEMETRY_STALE_MS)).toBe(true)
  })
})
