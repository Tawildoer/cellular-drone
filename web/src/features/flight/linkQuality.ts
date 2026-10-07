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

/** One second of the strength graph: its grade, or why there isn't one. */
export type StrengthSlot = Grade | 'down' | 'unknown' | 'empty'

/**
 * The last `count` seconds of link quality, oldest first, newest last, one
 * slot per second counted back from the newest point. 'down' = the link was
 * down; 'unknown' = up but nothing measured (e.g. a link without stats);
 * 'empty' = no point for that second (before history began).
 */
export function strengthSlots(history: LinkHistoryPoint[], count = 10): StrengthSlot[] {
  const slots: StrengthSlot[] = Array.from({ length: count }, () => 'empty')
  const end = history.at(-1)?.at
  if (end === undefined) return slots
  for (const point of history) {
    const age = Math.round((end - point.at) / 1000)
    if (age >= count) continue
    slots[count - 1 - age] = point.up
      ? (linkGrade({ state: 'connected', rttMs: point.rttMs, videoFps: point.videoFps, packetLossPct: point.packetLossPct }) ?? 'unknown')
      : 'down'
  }
  return slots
}
