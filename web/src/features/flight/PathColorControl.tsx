import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { CELL_LEVEL_LABELS, PATH_COLOR_METRICS, type CellLevel, type PathColorMetric, type PathColorScale } from '../../domain'
import {
  CELL_COLORS,
  MAGNITUDE_RAMP,
  NO_DATA_COLOR,
  PATH_COLOR_LABELS,
  WIND_CALM,
  WIND_HEAD,
  WIND_TAIL,
} from './pathColoring'

const HINTS: Record<PathColorMetric, string> = {
  off: 'Usual colours: the route by headwind, the last minute of trail',
  wind: 'Wind along the track: tailwind to headwind',
  cell: 'Cell signal measured in flight; the route by what earlier flights measured there',
  height: 'Height above home',
  speed: 'Ground speed; the route at cruise in the wind',
}

/**
 * The map's path colour setting: a button showing the current choice that
 * opens a short list, and under it the key for what the colours mean.
 * Coloured by anything, the trail keeps the whole flight.
 */
export function PathColorControl({
  metric,
  scale,
  onChange,
}: {
  metric: PathColorMetric
  scale: PathColorScale | null
  onChange: (metric: PathColorMetric) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1.5 self-stretch">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={HINTS[metric]}
        className="glass-panel hud-label flex items-center justify-between gap-1.5 px-2.5 py-1.5 transition hover:ring-2 hover:ring-primary"
        style={metric !== 'off' ? { color: 'var(--primary)' } : undefined}
      >
        <span className="whitespace-nowrap">Path · {PATH_COLOR_LABELS[metric]}</span>
        <ChevronDown size={12} aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Colour the paths by"
          className="glass-panel glass-dense absolute right-0 top-full z-20 mt-1 flex w-full min-w-36 flex-col gap-0.5 p-1"
        >
          {PATH_COLOR_METRICS.map((m) => (
            <button
              key={m}
              type="button"
              role="option"
              aria-selected={m === metric}
              title={HINTS[m]}
              onClick={() => {
                onChange(m)
                setOpen(false)
              }}
              className="hud-label rounded-md px-2 py-1 text-left transition hover:bg-accent"
              style={m === metric ? { color: 'var(--primary)', background: 'var(--accent)' } : undefined}
            >
              {PATH_COLOR_LABELS[m]}
            </button>
          ))}
        </div>
      )}

      {metric !== 'off' && !open && <PathColorLegend metric={metric} scale={scale} />}
    </div>
  )
}

function gradient(colors: string[]): string {
  return `linear-gradient(90deg, ${colors.join(', ')})`
}

function PathColorLegend({ metric, scale }: { metric: Exclude<PathColorMetric, 'off'>; scale: PathColorScale | null }) {
  return (
    <div className="glass-panel flex flex-col gap-1 px-2.5 py-1.5" role="status" aria-live="polite">
      <span className="hud-label" style={{ color: 'var(--primary)' }}>
        {metric === 'cell' ? 'Cell signal' : metric === 'wind' ? 'Wind on the track' : metric === 'height' ? 'Height above home' : 'Ground speed'}
      </span>

      {metric === 'cell' ? (
        <div className="flex flex-col gap-0.5">
          {([3, 2, 1, 0] as CellLevel[]).map((level) => (
            <Swatch key={level} color={CELL_COLORS[level]!} label={CELL_LEVEL_LABELS[level]} />
          ))}
          <Swatch color={NO_DATA_COLOR} label="Not flown yet" />
        </div>
      ) : scale ? (
        <div className="flex flex-col gap-0.5">
          <span
            aria-hidden
            className="h-1.5 w-full rounded-full"
            style={{ background: metric === 'wind' ? gradient([WIND_TAIL, WIND_CALM, WIND_HEAD]) : gradient(MAGNITUDE_RAMP) }}
          />
          <span className="flex justify-between gap-2 text-[0.625rem] tabular-nums">
            {metric === 'wind' ? (
              <>
                <span>Tail {Math.abs(scale.min)}</span>
                <span>Calm</span>
                <span>Head {scale.max} m/s</span>
              </>
            ) : (
              <>
                <span>{scale.min}</span>
                <span>
                  {scale.max} {metric === 'height' ? 'm' : 'm/s'}
                </span>
              </>
            )}
          </span>
        </div>
      ) : (
        <span className="text-[0.625rem]">{metric === 'wind' ? 'No wind reading or forecast yet' : 'Nothing flown yet'}</span>
      )}
    </div>
  )
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[0.6875rem]">
      <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}
