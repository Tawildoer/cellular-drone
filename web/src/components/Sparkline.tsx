import { useState, type PointerEvent } from 'react'

export interface SparkPoint {
  /** epoch ms */
  at: number
  /** Undefined = no measurement then (e.g. link down): drawn as a gap, not a zero. */
  value?: number
}

export interface SparklineProps {
  points: SparkPoint[]
  windowMs: number
  /** The y-axis reaches at least this high, so a small wobble in a quiet
   * signal isn't stretched into a dramatic-looking swing. */
  minScaleMax: number
  /** A dashed reference line, e.g. the threshold where quality starts to suffer. */
  reference?: number
  format: (value: number) => string
  /** What the series is, for screen readers ("Round-trip time, last minute"). */
  label: string
  width?: number
  height?: number
}

const PAD = 4

/**
 * One series over a fixed time window, newest at the right edge. History is
 * a thin muted line and the latest value an accent dot, so the eye lands on
 * "now" first. Hovering shows a crosshair and the value at that moment.
 */
export function Sparkline({ points, windowMs, minScaleMax, reference, format, label, width = 132, height = 32 }: SparklineProps) {
  const [hover, setHover] = useState<Required<SparkPoint> | null>(null)
  const end = points.at(-1)?.at ?? 0
  const defined = points.filter((p): p is Required<SparkPoint> => p.value !== undefined)
  const top = Math.max(minScaleMax, ...defined.map((p) => p.value)) * 1.1

  const x = (at: number) => width - ((end - at) / windowMs) * width
  const y = (value: number) => height - PAD - (value / top) * (height - 2 * PAD)

  let path = ''
  let penDown = false
  for (const p of points) {
    if (p.value === undefined) {
      penDown = false
      continue
    }
    path += `${penDown ? 'L' : 'M'}${x(p.at).toFixed(1)} ${y(p.value).toFixed(1)}`
    penDown = true
  }
  const latest = defined.at(-1)
  const marked = hover ?? latest

  function handlePointerMove(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const at = end - (1 - (e.clientX - rect.left) / rect.width) * windowMs
    let nearest: Required<SparkPoint> | null = null
    for (const p of defined) {
      if (!nearest || Math.abs(p.at - at) < Math.abs(nearest.at - at)) nearest = p
    }
    setHover(nearest)
  }

  return (
    <div className="relative" style={{ width, height }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={latest ? `${label}: now ${format(latest.value)}` : `${label}: no data`}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHover(null)}
        className="block overflow-visible"
      >
        {reference !== undefined && reference <= top && (
          <line x1={0} x2={width} y1={y(reference)} y2={y(reference)} stroke="var(--glass-border-hover)" strokeWidth={1} strokeDasharray="3 3" />
        )}
        <path d={path} fill="none" stroke="var(--muted-foreground)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover && <line x1={x(hover.at)} x2={x(hover.at)} y1={0} y2={height} stroke="var(--glass-border-hover)" strokeWidth={1} />}
        {marked && <circle cx={x(marked.at)} cy={y(marked.value)} r={4} fill="var(--primary)" stroke="var(--glass-bg)" strokeWidth={2} />}
      </svg>
      {hover && (
        <div
          className="glass-panel pointer-events-none absolute bottom-full z-20 mb-1 whitespace-nowrap px-1.5 py-0.5 text-[0.625rem]"
          style={{ left: Math.min(Math.max(0, x(hover.at) - 40), width - 80), color: 'var(--foreground)' }}
        >
          {format(hover.value)} · {Math.round((end - hover.at) / 1000)} s ago
        </div>
      )}
    </div>
  )
}
