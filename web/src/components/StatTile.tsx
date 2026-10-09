import type { LucideIcon } from 'lucide-react'
import { HoverDrawer, type DrawerRow } from './HoverDrawer'

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
  /** Fixed width (px), sized for the longest value, so the bar doesn't
   * shift as values change. */
  width?: number
  /** Stretch to share a row's spare space, with `width` as the minimum
   * (the top bar spans the screen). */
  grow?: boolean
  /** Extra readings for a drawer that slides down from the bar on hover. */
  more?: DrawerRow[]
}

export function StatTile({ label, value, detail, icon: Icon, status, shortLabel, hideLabel, width, grow, more }: StatTileProps) {
  const statusColor = status ? `var(--status-${status})` : undefined

  // One compact island in the top bar: [icon] LABEL value detail, on a
  // slightly lighter tile so each metric stands on its own.
  const tile = (
    <div
      className={`flex h-7 items-center gap-1 overflow-hidden rounded-lg bg-secondary px-1.5 glass-tile ${grow ? 'flex-1 justify-center' : 'shrink-0'}`}
      style={width ? (grow ? { minWidth: width } : { width }) : undefined}
    >
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

  return more ? (
    <HoverDrawer title={label} rows={more} className={grow ? 'flex flex-1' : undefined}>
      {tile}
    </HoverDrawer>
  ) : (
    tile
  )
}
