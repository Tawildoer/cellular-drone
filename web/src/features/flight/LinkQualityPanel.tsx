import { useVehicleStore } from '../../app/store-hooks'
import { Sparkline } from '../../components/Sparkline'
import type { LinkStatus } from '../../domain'
import { LINK_HISTORY_WINDOW_MS, type LinkHistoryPoint } from '../../state'
import {
  formatKbps,
  formatPath,
  GRADE_LABEL,
  gradeHigherWorse,
  gradeLowerWorse,
  gradeStatus,
  linkGrade,
  THRESHOLDS,
  type Grade,
} from './linkQuality'

type MetricKey = 'rttMs' | 'videoKbps' | 'videoFps' | 'packetLossPct' | 'jitterMs'

interface Metric {
  key: MetricKey
  label: string
  minScaleMax: number
  reference?: number
  format: (value: number) => string
  grade?: (value: number) => Grade | undefined
}

const METRICS: Metric[] = [
  {
    key: 'rttMs',
    label: 'Round-trip time',
    minScaleMax: 200,
    reference: THRESHOLDS.rttMs.fair,
    format: (v) => `${Math.round(v)} ms`,
    grade: (v) => gradeHigherWorse(v, THRESHOLDS.rttMs),
  },
  { key: 'videoKbps', label: 'Video bitrate', minScaleMax: 2000, format: (v) => formatKbps(v) },
  {
    key: 'videoFps',
    label: 'Frame rate',
    minScaleMax: 30,
    reference: THRESHOLDS.videoFps.fair,
    format: (v) => `${Math.round(v)} fps`,
    grade: (v) => gradeLowerWorse(v, THRESHOLDS.videoFps),
  },
  {
    key: 'packetLossPct',
    label: 'Packet loss',
    minScaleMax: 5,
    reference: THRESHOLDS.packetLossPct.fair,
    format: (v) => `${v.toFixed(1)}%`,
    grade: (v) => gradeHigherWorse(v, THRESHOLDS.packetLossPct),
  },
  {
    key: 'jitterMs',
    label: 'Jitter',
    minScaleMax: 50,
    reference: THRESHOLDS.jitterMs.fair,
    format: (v) => `${Math.round(v)} ms`,
    grade: (v) => gradeHigherWorse(v, THRESHOLDS.jitterMs),
  },
]

function GradeChip({ grade, emptyLabel }: { grade: Grade | undefined; emptyLabel: string }) {
  const status = gradeStatus(grade)
  return (
    <span className="flex items-center gap-1">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: status ? `var(--status-${status})` : 'var(--text-dim)' }}
        aria-hidden
      />
      <span className="hud-label" style={{ color: 'var(--foreground)' }}>
        {grade ? GRADE_LABEL[grade] : emptyLabel}
      </span>
    </span>
  )
}

function MetricRow({ metric, status, history }: { metric: Metric; status: LinkStatus | null; history: LinkHistoryPoint[] }) {
  const latest = history.at(-1)?.[metric.key]
  const grade = latest !== undefined ? metric.grade?.(latest) : undefined

  return (
    <li className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="hud-label">{metric.label}</span>
        <span className="flex items-center gap-2">
          <span className="text-sm tabular-nums" style={{ color: 'var(--foreground)' }}>
            {latest !== undefined && status ? metric.format(latest) : '—'}
          </span>
          {metric.grade && latest !== undefined && <GradeChip grade={grade} emptyLabel="" />}
        </span>
      </div>
      <Sparkline
        points={history.map((p) => ({ at: p.at, value: p[metric.key] }))}
        windowMs={LINK_HISTORY_WINDOW_MS}
        minScaleMax={metric.minScaleMax}
        reference={metric.reference}
        format={metric.format}
        label={`${metric.label}, last minute`}
      />
    </li>
  )
}

/** Live link quality: latency, video feed health and the network path,
 * each with the last minute as a sparkline. Values come from the link's own
 * WebRTC statistics; links that don't measure something show a dash. */
export function LinkQualityPanel() {
  const linkStatus = useVehicleStore((s) => s.linkStatus)
  const history = useVehicleStore((s) => s.linkHistory)
  const freezes = linkStatus?.videoFreezeCount

  return (
    <div className="glass-panel flex w-80 flex-col gap-2 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 pl-8">
        <span className="hud-label" style={{ color: 'var(--foreground)' }}>
          Link quality
        </span>
        <GradeChip grade={linkGrade(linkStatus)} emptyLabel="No link" />
      </div>
      <span className="hud-label text-[0.625rem]">{formatPath(linkStatus)}</span>
      <ul className="flex flex-col gap-2">
        {METRICS.map((metric) => (
          <MetricRow key={metric.key} metric={metric} status={linkStatus} history={history} />
        ))}
      </ul>
      <span className="hud-label text-[0.625rem]">
        Video freezes: {freezes !== undefined ? `${freezes} (${(linkStatus?.videoFreezeSeconds ?? 0).toFixed(1)} s total)` : '—'}
      </span>
    </div>
  )
}
