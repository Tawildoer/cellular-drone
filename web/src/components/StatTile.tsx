import type { LucideIcon } from 'lucide-react'

export type StatStatus = 'good' | 'warning' | 'serious' | 'critical'

export interface StatTileProps {
  /** Sentence case, no trailing colon — the hud-label CSS class handles the uppercase display. */
  label: string
  value: string
  detail?: string
  icon?: LucideIcon
  /** Fixed status palette (good/warning/serious/critical). Never the only signal — label/value text should already say what's wrong. */
  status?: StatStatus
}

export function StatTile({ label, value, detail, icon: Icon, status }: StatTileProps) {
  const statusColor = status ? `var(--status-${status})` : undefined

  return (
    <div className="flex min-w-[72px] flex-col gap-0.5 rounded-lg border border-border/60 bg-card/40 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon size={12} aria-hidden style={{ color: statusColor ?? 'var(--text-dim)' }} />}
        <span className="hud-label">{label}</span>
      </div>
      <span className="hud-value" style={statusColor ? { color: statusColor, textShadow: 'none' } : undefined}>
        {value}
      </span>
      {detail && <span className="hud-label text-[0.625rem]">{detail}</span>}
    </div>
  )
}
