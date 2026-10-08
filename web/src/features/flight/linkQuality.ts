import type { StatStatus } from '../../components/StatTile'
import type { LinkStatus } from '../../domain'
import type { LinkHistoryPoint } from '../../state'

export type Grade = 'good' | 'fair' | 'poor'

/** Thresholds for supervising an autonomous drone, not for a video call:
 * commands and telemetry tolerate more delay than conversation does, but a
 * feed that stutters or lags by half a second stops being useful for
 * watching the aircraft. `fair` is where it starts to suffer, `poor` where
 * it's no longer fit to rely on. */
export const THRESHOLDS = {
  rttMs: { fair: 150, poor: 400 },
  packetLossPct: { fair: 1, poor: 5 },
  jitterMs: { fair: 30, poor: 80 },
  /** Lower is worse: below `fair` fps the feed visibly stutters. */
  videoFps: { fair: 25, poor: 15 },
} as const

const ORDER: Grade[] = ['good', 'fair', 'poor']

function worst(grades: (Grade | undefined)[]): Grade | undefined {
  let result: Grade | undefined
  for (const grade of grades) {
    if (grade && (!result || ORDER.indexOf(grade) > ORDER.indexOf(result))) result = grade
  }
  return result
}

/** For measures where higher is worse (RTT, loss, jitter). */
export function gradeHigherWorse(value: number | undefined, t: { fair: number; poor: number }): Grade | undefined {
  if (value === undefined) return undefined
  return value >= t.poor ? 'poor' : value >= t.fair ? 'fair' : 'good'
}

/** For measures where lower is worse (frame rate). */
export function gradeLowerWorse(value: number | undefined, t: { fair: number; poor: number }): Grade | undefined {
  if (value === undefined) return undefined
  return value < t.poor ? 'poor' : value < t.fair ? 'fair' : 'good'
}

export function gradeStatus(grade: Grade | undefined): StatStatus | undefined {
  if (grade === 'good') return 'good'
  if (grade === 'fair') return 'warning'
  if (grade === 'poor') return 'critical'
  return undefined
}

export const GRADE_LABEL: Record<Grade, string> = { good: 'Good', fair: 'Fair', poor: 'Poor' }

function isUp(status: LinkStatus | null): status is LinkStatus {
  return !!status && (status.state === 'connected' || status.state === 'degraded')
}

/** Video feed quality: frame rate and packet loss, the two things that make
 * a feed stutter or smear. Undefined when there's no video to judge. */
export function videoGrade(status: LinkStatus | null): Grade | undefined {
  if (!isUp(status) || status.videoFps === undefined) return undefined
  return worst([
    gradeLowerWorse(status.videoFps, THRESHOLDS.videoFps),
    gradeHigherWorse(status.packetLossPct, THRESHOLDS.packetLossPct),
  ])
}

/** The whole link: latency plus, when there is video, the feed's quality. */
export function linkGrade(status: LinkStatus | null): Grade | undefined {
  if (!isUp(status)) return undefined
  return worst([gradeHigherWorse(status.rttMs, THRESHOLDS.rttMs), videoGrade(status)])
}

export function formatKbps(kbps: number | undefined): string {
  if (kbps === undefined) return '—'
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbit/s` : `${Math.round(kbps)} kbit/s`
}

/** "IPv6 · Direct · host → srflx" — what kind of path the link took. */
export function formatPath(status: LinkStatus | null): string {
  if (!isUp(status)) return 'No link'
  const parts = [
    status.ipVersion ? `IPv${status.ipVersion}` : undefined,
    status.path === 'relayed' ? 'Relayed' : status.path === 'direct' ? 'Direct' : undefined,
    status.pairKinds,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'Connected'
}

/** Where the grade thresholds sit on the 0–1 strength scale. Fixed heights,
 * so the strength line's colour bands are exactly the grades. */
export const STRENGTH_FAIR = 2 / 3
export const STRENGTH_POOR = 1 / 3

/** Straight lines between (value, score) knots, flat beyond the ends. */
function interpolate(value: number, knots: [number, number][]): number {
  const first = knots[0]!
  const last = knots.at(-1)!
  if (value <= first[0]) return first[1]
  if (value >= last[0]) return last[1]
  for (let i = 1; i < knots.length; i++) {
    const [x1, y1] = knots[i]!
    const [x0, y0] = knots[i - 1]!
    if (value <= x1) return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0)
  }
  return last[1]
}

/** 1 at half the fair threshold or better, through the thresholds, 0 at
 * twice the poor one. For RTT, loss and jitter. */
export function scoreHigherWorse(value: number | undefined, t: { fair: number; poor: number }): number | undefined {
  if (value === undefined) return undefined
  return interpolate(value, [
    [t.fair / 2, 1],
    [t.fair, STRENGTH_FAIR],
    [t.poor, STRENGTH_POOR],
    [t.poor * 2, 0],
  ])
}

/** 0 at nothing, through the thresholds, 1 as far above fair as fair is
 * above poor. For frame rate. */
export function scoreLowerWorse(value: number | undefined, t: { fair: number; poor: number }): number | undefined {
  if (value === undefined) return undefined
  return interpolate(value, [
    [0, 0],
    [t.poor, STRENGTH_POOR],
    [t.fair, STRENGTH_FAIR],
    [t.fair + (t.fair - t.poor) / 2, 1],
  ])
}

/**
 * How strong the link is, 0–1: the weakest of latency, frame rate and packet
 * loss (the same measures as linkGrade), each on a continuous scale through
 * the same thresholds, so its colour band agrees with linkGrade (bar a
 * reading sitting exactly on a threshold).
 * Undefined when nothing was measured.
 */
export function linkScore(m: Pick<LinkHistoryPoint, 'rttMs' | 'videoFps' | 'packetLossPct'>): number | undefined {
  const scores = [
    scoreHigherWorse(m.rttMs, THRESHOLDS.rttMs),
    // Frame rate and loss judge the video feed: only when there is one (videoGrade).
    m.videoFps === undefined ? undefined : scoreLowerWorse(m.videoFps, THRESHOLDS.videoFps),
    m.videoFps === undefined ? undefined : scoreHigherWorse(m.packetLossPct, THRESHOLDS.packetLossPct),
  ].filter((v): v is number => v !== undefined)
  return scores.length === 0 ? undefined : Math.min(...scores)
}

export function strengthGrade(score: number): Grade {
  return score > STRENGTH_FAIR ? 'good' : score > STRENGTH_POOR ? 'fair' : 'poor'
}

/** One moment on the strength line: when, and the score, or why there isn't one. */
export interface StrengthPoint {
  /** How long before the newest point, ms. */
  ageMs: number
  /** 'down' = link down, 'unknown' = up but nothing measured. */
  score: number | 'down' | 'unknown'
}

/** The last `windowMs` of link strength, oldest first, timed back from the
 * newest point (so the line doesn't need a ticking clock of its own). */
export function strengthSeries(history: LinkHistoryPoint[], windowMs = 10_000): StrengthPoint[] {
  const end = history.at(-1)?.at
  if (end === undefined) return []
  return history
    .filter((p) => end - p.at <= windowMs)
    .map((p) => ({ ageMs: end - p.at, score: p.up ? (linkScore(p) ?? 'unknown') : 'down' }))
}
