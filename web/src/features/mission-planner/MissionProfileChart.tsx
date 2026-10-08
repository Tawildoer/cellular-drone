import { useState, type PointerEvent } from 'react'
import { TERRAIN_CLEARANCE_WARN_M, type ClearanceSample, type MissionProfile, type TerrainClearance } from '../../domain'
import { formatDistance, niceDomain, niceTicks } from './profileFormat'

/** Violet like the map's planned path (FlightMap), so the two read as one
 * route; earth for the ground. Validated together on the panel surface
 * (dataviz validate_palette, dark mode): lightness, chroma, CVD and contrast
 * all pass. */
const PLANNED_COLOR = '#9f6fff'
const GROUND_COLOR = '#b9853f'

const WIDTH = 456
const HEIGHT = 150
const MARGIN = { top: 8, right: 10, bottom: 20, left: 36 }
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom

interface Props {
  profile: MissionProfile
  /** Null while there's no terrain: the chart shows the planned heights only. */
  clearance: TerrainClearance | null
}

function clearanceColor(clearanceM: number): string {
  return clearanceM < 0 ? 'var(--status-critical)' : 'var(--status-warning)'
}

/** Consecutive samples with ground data, as separate runs (no data = gap). */
function groundRuns(samples: ClearanceSample[]): ClearanceSample[][] {
  const runs: ClearanceSample[][] = []
  let run: ClearanceSample[] = []
  for (const s of samples) {
    if (s.groundM === null) {
      if (run.length > 1) runs.push(run)
      run = []
    } else run.push(s)
  }
  if (run.length > 1) runs.push(run)
  return runs
}

/**
 * The route side-on: planned height above home against distance along the
 * route, over the ground under it. Parts closer to the ground than
 * TERRAIN_CLEARANCE_WARN_M are drawn over in the warning colour, or the
 * critical one where the plan is below the ground.
 */
export function MissionProfileChart({ profile, clearance }: Props) {
  const [hoverM, setHoverM] = useState<number | null>(null)
  const samples = clearance?.samples ?? []
  const grounds = samples.map((s) => s.groundM).filter((g): g is number => g !== null)
  const y = niceDomain(Math.min(0, ...grounds), Math.max(profile.maxAltM, ...grounds, 10), 4)
  const maxDistanceM = Math.max(profile.routeDistanceM, 1)

  const sx = (distanceM: number) => MARGIN.left + (distanceM / maxDistanceM) * PLOT_W
  const sy = (altM: number) => MARGIN.top + ((y.max - altM) / (y.max - y.min)) * PLOT_H
  const xTicks = niceTicks(0, maxDistanceM, 5)

  const plannedPoints = profile.vertices.map((v) => `${sx(v.distanceM)},${sy(v.altM)}`).join(' ')
  const markers = profile.vertices.filter(
    (v, i, all) => v.itemIndex !== null && all.findIndex((w) => w.itemIndex === v.itemIndex) === i,
  )

  // Low-clearance stretches: pairs of neighbouring samples both under the margin.
  const lowSegments = samples.flatMap((s, i) => {
    const next = samples[i + 1]
    if (!next || s.clearanceM === null || next.clearanceM === null) return []
    if (s.clearanceM >= TERRAIN_CLEARANCE_WARN_M || next.clearanceM >= TERRAIN_CLEARANCE_WARN_M) return []
    return [{ from: s, to: next, color: clearanceColor(Math.min(s.clearanceM, next.clearanceM)) }]
  })

  const hovered = hoverM === null ? null : nearest(samples, hoverM) ?? nearestVertex(profile, hoverM)

  function handlePointer(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    const xView = ((event.clientX - box.left) / box.width) * WIDTH
    const distanceM = ((xView - MARGIN.left) / PLOT_W) * maxDistanceM
    setHoverM(Math.min(maxDistanceM, Math.max(0, distanceM)))
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`Height profile: planned height above home and the ground along ${formatDistance(profile.routeDistanceM)} of route`}
        onPointerMove={handlePointer}
        onPointerLeave={() => setHoverM(null)}
      >
        {y.ticks.map((t) => (
          <g key={`y${t}`}>
            <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={sy(t)} y2={sy(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={MARGIN.left - 4} y={sy(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[9px]">
              {t}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} x={sx(t)} y={HEIGHT - 6} textAnchor="middle" className="fill-muted-foreground text-[9px]">
            {t === 0 ? '0' : formatDistance(t)}
          </text>
        ))}

        {groundRuns(samples).map((run, i) => {
          const top = run.map((s) => `${sx(s.distanceM)},${sy(s.groundM!)}`).join(' ')
          const base = `${sx(run.at(-1)!.distanceM)},${sy(y.min)} ${sx(run[0]!.distanceM)},${sy(y.min)}`
          return (
            <g key={i}>
              <polygon points={`${top} ${base}`} fill={GROUND_COLOR} fillOpacity={0.18} />
              <polyline points={top} fill="none" stroke={GROUND_COLOR} strokeWidth={1.5} strokeLinejoin="round" />
            </g>
          )
        })}

        <polyline points={plannedPoints} fill="none" stroke={PLANNED_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {lowSegments.map(({ from, to, color }, i) => (
          <line
            key={i}
            x1={sx(from.distanceM)}
            y1={sy(from.altM)}
            x2={sx(to.distanceM)}
            y2={sy(to.altM)}
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
          />
        ))}

        {markers.map((v) => (
          <g key={v.itemIndex}>
            <circle cx={sx(v.distanceM)} cy={sy(v.altM)} r={4} fill={PLANNED_COLOR} stroke="var(--background)" strokeWidth={2} />
          </g>
        ))}

        {hovered && (
          <line
            x1={sx(hovered.distanceM)}
            x2={sx(hovered.distanceM)}
            y1={MARGIN.top}
            y2={MARGIN.top + PLOT_H}
            stroke="var(--muted-foreground)"
            strokeWidth={1}
          />
        )}
      </svg>

      {hovered && <Tooltip sample={hovered} leftPct={(sx(hovered.distanceM) / WIDTH) * 100} />}
    </div>
  )
}

type HoverPoint = Pick<ClearanceSample, 'distanceM' | 'altM'> & Partial<Pick<ClearanceSample, 'groundM' | 'clearanceM'>>

function nearest(samples: ClearanceSample[], distanceM: number): HoverPoint | null {
  let best: ClearanceSample | null = null
  for (const s of samples) {
    if (!best || Math.abs(s.distanceM - distanceM) < Math.abs(best.distanceM - distanceM)) best = s
  }
  return best
}

function nearestVertex(profile: MissionProfile, distanceM: number): HoverPoint | null {
  let best: HoverPoint | null = null
  for (const v of profile.vertices) {
    if (!best || Math.abs(v.distanceM - distanceM) < Math.abs(best.distanceM - distanceM)) best = v
  }
  return best
}

function Tooltip({ sample, leftPct }: { sample: HoverPoint; leftPct: number }) {
  const { clearanceM } = sample
  return (
    <div
      className="glass-panel pointer-events-none absolute top-1 flex flex-col gap-0.5 px-2 py-1 text-xs"
      style={leftPct > 55 ? { right: `${100 - leftPct + 2}%` } : { left: `${leftPct + 2}%` }}
    >
      <span className="hud-label">{formatDistance(sample.distanceM)} along</span>
      <Row color={PLANNED_COLOR} value={`${Math.round(sample.altM)} m`} label="planned" />
      {sample.groundM != null && <Row color={GROUND_COLOR} value={`${Math.round(sample.groundM)} m`} label="ground" />}
      {clearanceM != null && (
        <span>
          <strong style={clearanceM < TERRAIN_CLEARANCE_WARN_M ? { color: clearanceColor(clearanceM) } : undefined}>
            {Math.round(clearanceM)} m
          </strong>{' '}
          <span className="opacity-70">{clearanceM < 0 ? 'below ground' : 'clearance'}</span>
        </span>
      )}
    </div>
  )
}

function Row({ color, value, label }: { color: string; value: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-0.5 w-3 rounded" style={{ background: color }} aria-hidden />
      <strong>{value}</strong>
      <span className="opacity-70">{label}</span>
    </span>
  )
}

/** Key for the two series, above the chart. */
export function MissionProfileLegend({ hasGround }: { hasGround: boolean }) {
  return (
    <div className="flex items-center gap-3 text-xs opacity-80">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-3 rounded" style={{ background: PLANNED_COLOR }} aria-hidden />
        Planned height
      </span>
      {hasGround && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: GROUND_COLOR, opacity: 0.6 }} aria-hidden />
          Ground
        </span>
      )}
      <span className="ml-auto opacity-70">m above home</span>
    </div>
  )
}
