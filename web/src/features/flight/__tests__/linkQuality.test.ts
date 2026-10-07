import { describe, expect, it } from 'vitest'
import { formatKbps, formatPath, gradeHigherWorse, gradeLowerWorse, linkGrade, strengthSlots, THRESHOLDS, videoGrade } from '../linkQuality'

describe('grading', () => {
  it('grades higher-is-worse measures at the fair and poor thresholds', () => {
    expect(gradeHigherWorse(149, THRESHOLDS.rttMs)).toBe('good')
    expect(gradeHigherWorse(150, THRESHOLDS.rttMs)).toBe('fair')
    expect(gradeHigherWorse(400, THRESHOLDS.rttMs)).toBe('poor')
    expect(gradeHigherWorse(undefined, THRESHOLDS.rttMs)).toBeUndefined()
  })

  it('grades frame rate as lower-is-worse', () => {
    expect(gradeLowerWorse(30, THRESHOLDS.videoFps)).toBe('good')
    expect(gradeLowerWorse(20, THRESHOLDS.videoFps)).toBe('fair')
    expect(gradeLowerWorse(10, THRESHOLDS.videoFps)).toBe('poor')
  })

  it('rates video by its worst of frame rate and loss, and only when there is video', () => {
    expect(videoGrade({ state: 'connected', videoFps: 30, packetLossPct: 0 })).toBe('good')
    expect(videoGrade({ state: 'connected', videoFps: 30, packetLossPct: 6 })).toBe('poor')
    expect(videoGrade({ state: 'connected', rttMs: 40 })).toBeUndefined()
  })

  it('rates the link by its worst of latency and video', () => {
    expect(linkGrade({ state: 'connected', rttMs: 40, videoFps: 30 })).toBe('good')
    expect(linkGrade({ state: 'connected', rttMs: 200, videoFps: 30 })).toBe('fair')
    expect(linkGrade({ state: 'connected', rttMs: 40, videoFps: 10 })).toBe('poor')
  })

  it('has no grade while the link is down', () => {
    expect(linkGrade({ state: 'connecting', rttMs: 40 })).toBeUndefined()
    expect(linkGrade(null)).toBeUndefined()
  })
})

describe('formatting', () => {
  it('formats bitrate in kbit/s, switching to Mbit/s at 1000', () => {
    expect(formatKbps(850)).toBe('850 kbit/s')
    expect(formatKbps(1530)).toBe('1.5 Mbit/s')
    expect(formatKbps(undefined)).toBe('—')
  })

  it('describes the path: IP version, direct or relayed, candidate kinds', () => {
    expect(formatPath({ state: 'connected', ipVersion: 6, path: 'direct', pairKinds: 'host → host' })).toBe('IPv6 · Direct · host → host')
    expect(formatPath({ state: 'connected', path: 'relayed' })).toBe('Relayed')
    expect(formatPath({ state: 'disconnected' })).toBe('No link')
  })
})

describe('strengthSlots', () => {
  const at = (s: number) => 1_000_000 + s * 1000

  it('lays the last ten seconds out oldest first, newest last', () => {
    const history = [
      { at: at(0), up: true, rttMs: 40 },
      { at: at(1), up: true, rttMs: 200 },
      { at: at(2), up: true, rttMs: 500 },
    ]
    expect(strengthSlots(history, 10).slice(-3)).toEqual(['good', 'fair', 'poor'])
    expect(strengthSlots(history, 10).slice(0, 7)).toEqual(Array(7).fill('empty'))
  })

  it('drops seconds older than the window', () => {
    const history = Array.from({ length: 15 }, (_, s) => ({ at: at(s), up: true, rttMs: s < 5 ? 500 : 40 }))
    expect(strengthSlots(history, 10)).toEqual(Array(10).fill('good'))
  })

  it('marks seconds the link was down, and up-but-unmeasured seconds, distinctly', () => {
    const history = [
      { at: at(0), up: false },
      { at: at(1), up: true },
    ]
    expect(strengthSlots(history, 10).slice(-2)).toEqual(['down', 'unknown'])
  })

  it('grades a second by its worst measure, frame rate included', () => {
    expect(strengthSlots([{ at: at(0), up: true, rttMs: 40, videoFps: 10 }], 10).at(-1)).toBe('poor')
  })

  it('is all empty with no history', () => {
    expect(strengthSlots([], 10)).toEqual(Array(10).fill('empty'))
  })
})
