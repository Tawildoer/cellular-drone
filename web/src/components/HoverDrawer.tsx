import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { StatStatus } from './StatTile'

export interface DrawerRow {
  /** Sentence case; the hud-label class uppercases it. */
  label: string
  value: string
  /** Fixed status palette, as on StatTile; the value text still says it. */
  status?: StatStatus
}

/** Long enough to cross the gap from the tile into the drawer. */
const CLOSE_DELAY_MS = 120
/** Matches the hover-drawer-shrink animation in index.css. */
const SHRINK_MS = 180
/** Space between the bar the tile sits on and the drawer. */
const GAP_PX = 4

interface Anchor {
  top: number
  left: number
  width: number
}

/**
 * Wraps a top-bar tile so hovering (or focusing) it grows a drawer of extra
 * readings down out of the bar, exactly the tile's width, and shrinks it
 * back up on leaving. The drawer is portalled to the body: the bar scrolls
 * sideways on narrow screens, which would clip it. Rows stack label over
 * value so they fit the narrowest tile.
 */
export function HoverDrawer({
  title,
  rows,
  className = 'shrink-0',
  children,
}: {
  title: string
  rows: DrawerRow[]
  /** Layout of the wrapper in its row; `flex flex-1` lets the tile grow. */
  className?: string
  children: ReactNode
}) {
  const id = useId()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [closing, setClosing] = useState(false)

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  function open() {
    window.clearTimeout(closeTimer.current)
    setClosing(false)
    const el = wrapperRef.current
    if (!el) return
    const tile = el.getBoundingClientRect()
    // Drop from the bottom of the bar (the glass island), not the tile.
    const barBottom = el.closest('.glass-panel')?.getBoundingClientRect().bottom ?? tile.bottom
    setAnchor({ top: barBottom + GAP_PX, left: tile.left, width: tile.width })
  }

  /** Shrink back up, then unmount. */
  function close() {
    window.clearTimeout(closeTimer.current)
    setClosing(true)
    closeTimer.current = window.setTimeout(() => {
      setAnchor(null)
      setClosing(false)
    }, SHRINK_MS)
  }

  function scheduleClose() {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(close, CLOSE_DELAY_MS)
  }

  return (
    <div
      ref={wrapperRef}
      className={`${className} rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-primary`}
      tabIndex={0}
      aria-describedby={anchor ? id : undefined}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
      onFocus={open}
      onBlur={close}
      onKeyDown={(e) => e.key === 'Escape' && close()}
    >
      {children}
      {anchor &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            data-state={closing ? 'closing' : 'open'}
            className="glass-panel hover-drawer fixed z-50 flex flex-col gap-1.5 overflow-hidden px-2 py-2"
            style={{ top: anchor.top, left: anchor.left, width: anchor.width }}
            onMouseEnter={open}
            onMouseLeave={scheduleClose}
          >
            <span className="hud-label text-[0.5625rem]">{title}</span>
            <dl className="flex flex-col gap-1">
              {rows.map((row) => (
                <div key={row.label} className="flex min-w-0 flex-col">
                  <dt className="hud-label truncate text-[0.5rem]">{row.label}</dt>
                  <dd
                    className="hud-value break-words text-[0.6875rem] leading-tight"
                    style={row.status ? { color: `var(--status-${row.status})`, textShadow: 'none' } : undefined}
                  >
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>,
          document.body,
        )}
    </div>
  )
}
