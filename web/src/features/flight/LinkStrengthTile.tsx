import { useId } from 'react'
import { useVehicleStore } from '../../app/store-hooks'
import { HoverDrawer } from '../../components/HoverDrawer'
import { smoothPath, type PathPoint } from '../../components/smoothPath'
import { videoRows } from './hudDetails'
import {
  GRADE_LABEL,
  gradeStatus,
  STRENGTH_FAIR,
  STRENGTH_POOR,
  strengthGrade,
  strengthSeries,
  type StrengthPoint,
} from './linkQuality'

const WINDOW_MS = 10_000
/** The graph is the whole tile: wide enough to read ten seconds by. */
const WIDTH = 84
const HEIGHT = 18
const PAD = 2

const x = (ageMs: number) => WIDTH - (ageMs / WINDOW_MS) * WIDTH
const y = (score: number) => PAD + (1 - score) * (HEIGHT - 2 * PAD)

/** Unbroken stretches of measured strength; down or unmeasured moments split them. */
function measuredRuns(series: StrengthPoint[]): PathPoint[][] {
  const runs: PathPoint[][] = []
  let run: PathPoint[] = []
  for (const p of series) {
    if (typeof p.score === 'number') run.push({ x: x(p.ageMs), y: y(p.score) })
    else {
      if (run.length > 0) runs.push(run)
      run = []
    }
  }
  if (run.length > 0) runs.push(run)
  return runs
}

/** Stretches the link was down, as [from, to] x ranges. */
function downRuns(series: StrengthPoint[]): [number, number][] {
  const runs: [number, number][] = []
  series.forEach((p, i) => {
    if (p.score !== 'down') return
    const next = series[i + 1]
    const to = next ? x(next.ageMs) : WIDTH
    const last = runs.at(-1)
    if (last && Math.abs(last[1] - x(p.ageMs)) < 0.5) last[1] = to
    else runs.push([x(p.ageMs), to])
  })
  return runs
}

function summary(series: StrengthPoint[]): string {
  const scores = series.map((p) => p.score).filter((s): s is number => typeof s === 'number')
  const now = series.at(-1)?.score
  const nowText =
    typeof now === 'number' ? `now ${Math.round(now * 100)}% (${GRADE_LABEL[strengthGrade(now)]})` : now === 'down' ? 'now down' : 'no data'
  const low = scores.length > 0 ? `, lowest ${Math.round(Math.min(...scores) * 100)}%` : ''
  const downs = series.some((p) => p.score === 'down') ? ', with link drops' : ''
  return `Link strength, last ${WINDOW_MS / 1000} seconds: ${nowText}${low}${downs}`
}

/**
 * The last ten seconds of link strength as a smooth line, newest at the
 * right, moving left as samples arrive (four a second). Strength is 0–1,
 * the weakest of latency, frame rate and packet loss (linkQuality.ts); the
 * line's colour follows its height through the grade bands, so it reads
 * by position as well as colour. A link-down stretch is a dim stub along
 * the bottom; an unmeasured one is a gap.
 */
export function LinkStrengthTile() {
  const gradientId = useId()
  const history = useVehicleStore((s) => s.linkHistory)
  const linkStatus = useVehicleStore((s) => s.linkStatus)
  const series = strengthSeries(history, WINDOW_MS)
  const now = series.at(-1)?.score
  const grade = typeof now === 'number' ? strengthGrade(now) : undefined
  const statusColor = grade ? `var(--status-${gradeStatus(grade)})` : undefined
  const runs = measuredRuns(series)
  const latest = runs.at(-1)?.at(-1)

  // Hard stops at the grade boundaries, in the chart's own coordinates.
  const fairY = y(STRENGTH_FAIR)
  const poorY = y(STRENGTH_POOR)
  const span = HEIGHT - 2 * PAD
  const fairOffset = (fairY - PAD) / span
  const poorOffset = (poorY - PAD) / span

  const scores = series.map((p) => p.score).filter((s): s is number => typeof s === 'number')
  const pct = (score: number) => `${Math.round(score * 100)}%`
  const more = [
    {
      label: 'Strength',
      value: typeof now === 'number' ? `${pct(now)} ${GRADE_LABEL[strengthGrade(now)]}` : now === 'down' ? 'Down' : '—',
      status: grade ? gradeStatus(grade) : now === 'down' ? ('critical' as const) : undefined,
    },
    { label: `Lowest ${WINDOW_MS / 1000} s`, value: scores.length > 0 ? pct(Math.min(...scores)) : '—' },
    ...videoRows(linkStatus),
  ]

  return (
    <HoverDrawer title="Link strength" rows={more} className="flex flex-1">
      <div
        className="flex h-7 flex-1 items-center justify-center gap-1 overflow-hidden rounded-lg bg-secondary px-1.5 glass-tile"
        style={{ minWidth: 100 }}
      >
        <span className="hud-label sr-only">Link strength</span>
        <div className="flex items-center">
          <svg width={WIDTH} height={HEIGHT} role="img" aria-label={summary(series)} className="block overflow-visible">
            <defs>
              <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={PAD} y2={HEIGHT - PAD}>
                <stop offset={0} stopColor="var(--status-good)" />
                <stop offset={fairOffset} stopColor="var(--status-good)" />
                <stop offset={fairOffset} stopColor="var(--status-warning)" />
                <stop offset={poorOffset} stopColor="var(--status-warning)" />
                <stop offset={poorOffset} stopColor="var(--status-critical)" />
                <stop offset={1} stopColor="var(--status-critical)" />
              </linearGradient>
            </defs>
            {[fairY, poorY].map((ly) => (
              <line key={ly} x1={0} x2={WIDTH} y1={ly} y2={ly} stroke="var(--border)" strokeWidth={1} />
            ))}
            {downRuns(series).map(([from, to], i) => (
              <line key={i} x1={from} x2={to} y1={HEIGHT - 1} y2={HEIGHT - 1} stroke="var(--glass-border-hover)" strokeWidth={2} strokeLinecap="round" />
            ))}
            {runs.map((run, i) => {
              return (
                <path
                  key={i}
                  d={smoothPath(run)}
                  fill="none"
                  stroke={`url(#${gradientId})`}
                  strokeWidth={1.75}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )
            })}
            {latest && statusColor && (
              <circle cx={latest.x} cy={latest.y} r={3} fill={statusColor} stroke="var(--card)" strokeWidth={1.5} />
            )}
          </svg>
        </div>
      </div>
    </HoverDrawer>
  )
}
