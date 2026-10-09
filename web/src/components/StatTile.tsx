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
  /** Shown instead of `label` where space is tight (e.g. "Alt"); `label`
   * stays in the page for screen readers. */
  shortLabel?: string
  /** For values that explain themselves with their icon ("Armed", "98%"):
   * no visible label, `label` kept for screen readers. */
  hideLabel?: boolean
}

export function StatTile({ label, value, detail, icon: Icon, status, shortLabel, hideLabel }: StatTileProps) {
  const statusColor = status ? `var(--status-${status})` : undefined

  // One compact row for the top bar: [icon] LABEL value detail.
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-lg px-2">
      {Icon && <Icon size={12} aria-hidden className="shrink-0" style={{ color: statusColor ?? 'var(--text-dim)' }} />}
      {hideLabel || shortLabel ? <span className="hud-label sr-only">{label}</span> : null}
      {!hideLabel && (
        <span className="hud-label text-[0.5625rem]" aria-hidden={shortLabel ? true : undefined}>
          {shortLabel ?? label}
        </span>
      )}
      <span className="hud-value whitespace-nowrap" style={statusColor ? { color: statusColor, textShadow: 'none' } : undefined}>
        {value}
      </span>
      {detail && <span className="hud-label whitespace-nowrap text-[0.5625rem]">{detail}</span>}
    </div>
  )
}
