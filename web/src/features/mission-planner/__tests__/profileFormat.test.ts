import { describe, expect, it } from 'vitest'
import { formatDistance, formatDuration, niceDomain, niceTicks } from '../profileFormat'

describe('profile formatting', () => {
  it('formats distances', () => {
    expect(formatDistance(850.4)).toBe('850 m')
    expect(formatDistance(12_440)).toBe('12.4 km')
  })

  it('formats durations', () => {
    expect(formatDuration(245)).toBe('4:05')
    expect(formatDuration(3725)).toBe('1:02:05')
  })

  it('picks round ticks', () => {
    expect(niceTicks(0, 120, 4)).toEqual([0, 50, 100])
    expect(niceTicks(-20, 80, 4)).toEqual([0, 25, 50, 75])
    expect(niceTicks(0, 12_400, 5)).toEqual([0, 2500, 5000, 7500, 10_000])
  })

  it('widens a domain to whole steps', () => {
    expect(niceDomain(-20, 80, 4)).toEqual({ min: -25, max: 100, ticks: [-25, 0, 25, 50, 75, 100] })
    expect(niceDomain(0, 120, 4)).toEqual({ min: 0, max: 150, ticks: [0, 50, 100, 150] })
  })
})
