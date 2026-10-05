import { describe, expect, it } from 'vitest'
import { resolveLoiterUntilMs } from '../mission'

describe('resolveLoiterUntilMs', () => {
  const at = (h: number, m: number, day = 1) => Date.UTC(2026, 0, day, h, m)

  it('resolves a time later today to today', () => {
    expect(resolveLoiterUntilMs(at(12, 0), 14 * 60 + 30)).toBe(at(14, 30))
  })

  it('resolves a time just passed to today (already past), not tomorrow', () => {
    expect(resolveLoiterUntilMs(at(14, 35), 14 * 60 + 30)).toBe(at(14, 30))
  })

  it('resolves a time just after midnight, seen late in the evening, to tomorrow', () => {
    expect(resolveLoiterUntilMs(at(23, 50), 10)).toBe(at(0, 10, 2))
  })

  it('resolves a time late in the evening, seen just after midnight, to yesterday (already past)', () => {
    expect(resolveLoiterUntilMs(at(0, 10, 2), 23 * 60 + 50)).toBe(at(23, 50, 1))
  })
})
