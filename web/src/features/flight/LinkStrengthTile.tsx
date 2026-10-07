import { useVehicleStore } from '../../app/store-hooks'
import { GRADE_LABEL, gradeStatus, strengthSlots, type StrengthSlot } from './linkQuality'

const SECONDS = 10

/** Height encodes the grade as well as colour, like phone signal bars, so
 * the graph still reads without colour. */
const BAR_HEIGHT: Record<StrengthSlot, string> = {
  good: '100%',
  fair: '66%',
  poor: '33%',
  unknown: '50%',
  down: '2px',
  empty: '2px',
}

function barColor(slot: StrengthSlot): string {
  if (slot === 'good' || slot === 'fair' || slot === 'poor') return `var(--status-${gradeStatus(slot)})`
  if (slot === 'unknown') return 'var(--text-dim)'
  return 'var(--glass-border-hover)'
}

function currentLabel(slot: StrengthSlot | undefined): string {
  if (slot === 'good' || slot === 'fair' || slot === 'poor') return GRADE_LABEL[slot]
  if (slot === 'down') return 'Down'
  return '—'
}

function summary(slots: StrengthSlot[]): string {
  const counts = new Map<string, number>()
  for (const slot of slots) if (slot !== 'empty') counts.set(slot, (counts.get(slot) ?? 0) + 1)
  const parts = [...counts].map(([slot, n]) => `${n} ${slot}`)
  return `Link quality, last ${SECONDS} seconds: ${parts.length > 0 ? parts.join(', ') : 'no data'}`
}

/**
 * The last ten seconds of link quality as discrete bars, newest on the
 * right, scrolling left as each second arrives. Each bar is that second's
 * overall grade (worst of latency, frame rate and packet loss, see
 * linkQuality.ts) in traffic-light colours; a link-down second is a flat stub.
 */
export function LinkStrengthTile() {
  const history = useVehicleStore((s) => s.linkHistory)
  const slots = strengthSlots(history, SECONDS)
  const current = slots.at(-1)
  const status = current === 'good' || current === 'fair' || current === 'poor' ? gradeStatus(current) : undefined
  const statusColor = status ? `var(--status-${status})` : undefined

  return (
    <div className="flex min-w-[96px] flex-col gap-0.5 rounded-lg border border-border/60 bg-card/40 px-2 py-1.5">
      <span className="hud-label">Link · {SECONDS} s</span>
      <div className="flex items-end gap-2">
        <div role="img" aria-label={summary(slots)} className="flex h-[22px] items-end gap-[2px]">
          {slots.map((slot, i) => (
            <span
              key={i}
              className="w-[5px] rounded-[1px] transition-[height,background-color] duration-300"
              style={{ height: BAR_HEIGHT[slot], background: barColor(slot) }}
            />
          ))}
        </div>
        <span className="hud-value" style={statusColor ? { color: statusColor, textShadow: 'none' } : undefined}>
          {currentLabel(current)}
        </span>
      </div>
    </div>
  )
}
