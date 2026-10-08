import { describe, expect, it } from 'vitest'
import {
  formatKbps,
  formatPath,
  gradeHigherWorse,
  gradeLowerWorse,
  linkGrade,
  linkScore,
  scoreHigherWorse,
  scoreLowerWorse,
  STRENGTH_FAIR,
  STRENGTH_POOR,
  strengthGrade,
  strengthSeries,
  THRESHOLDS,
  videoGrade,
} from '../linkQuality'

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

describe('link strength score', () => {
  it('runs continuously through the grade thresholds', () => {
    const t = THRESHOLDS.rttMs
    expect(scoreHigherWorse(t.fair / 2, t)).toBe(1)
    expect(scoreHigherWorse(t.fair, t)).toBeCloseTo(STRENGTH_FAIR)
    expect(scoreHigherWorse(t.poor, t)).toBeCloseTo(STRENGTH_POOR)
    expect(scoreHigherWorse(t.poor * 2, t)).toBe(0)
    expect(scoreHigherWorse(9999, t)).toBe(0)
    // Strictly between thresholds it's strictly between their scores.
    const mid = scoreHigherWorse((t.fair + t.poor) / 2, t)!
    expect(mid).toBeLessThan(STRENGTH_FAIR)
    expect(mid).toBeGreaterThan(STRENGTH_POOR)
  })

  it('scores frame rate the other way up', () => {
    const t = THRESHOLDS.videoFps
    expect(scoreLowerWorse(0, t)).toBe(0)
    expect(scoreLowerWorse(t.poor, t)).toBeCloseTo(STRENGTH_POOR)
    expect(scoreLowerWorse(t.fair, t)).toBeCloseTo(STRENGTH_FAIR)
    expect(scoreLowerWorse(60, t)).toBe(1)
  })

  it('is the weakest measure, and lands in the same band as the grade', () => {
    for (const m of [{ rttMs: 40 }, { rttMs: 200 }, { rttMs: 500 }, { rttMs: 40, videoFps: 10 }, { rttMs: 40, videoFps: 30, packetLossPct: 3 }]) {
      expect(strengthGrade(linkScore(m)!)).toBe(linkGrade({ state: 'connected', ...m }))
    }
  })

  it('ignores loss when there is no video, like the grade', () => {
    expect(linkScore({ rttMs: 40, packetLossPct: 50 })).toBe(1)
    expect(linkScore({})).toBeUndefined()
  })
})

describe('strengthSeries', () => {
  const at = (ms: number) => 1_000_000 + ms

  it('times points back from the newest, oldest first, within the window', () => {
    const history = [
      { at: at(0), up: true, rttMs: 40 },
      { at: at(5_000), up: true, rttMs: 200 },
      { at: at(12_000), up: true, rttMs: 40 },
    ]
    const series = strengthSeries(history, 10_000)
    expect(series.map((p) => p.ageMs)).toEqual([7_000, 0])
    expect(series[0]!.score).toBeLessThan(STRENGTH_FAIR)
  })

  it('marks moments the link was down, and up but unmeasured, distinctly', () => {
    const series = strengthSeries([
      { at: at(0), up: false },
      { at: at(250), up: true },
    ])
    expect(series.map((p) => p.score)).toEqual(['down', 'unknown'])
  })

  it('is empty with no history', () => {
    expect(strengthSeries([])).toEqual([])
  })
})
