import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface HoldToConfirmButtonProps {
  onConfirm: () => void
  children: ReactNode
  durationMs?: number
  disabled?: boolean
  /** destructive = the "break glass" direction of a safety-relevant action (arming, forcing a landing). */
  variant?: 'default' | 'destructive'
}

const DEFAULT_DURATION_MS = 900

/** Press-and-hold confirm for safety-critical commands (arm, mission start,
 * RTL, QLAND) — a stray tap can't trigger them. Works with mouse, touch and
 * keyboard (Enter/Space held down), with a fill that visually tracks the
 * same duration the hold actually takes to register. */
export function HoldToConfirmButton({
  onConfirm,
  children,
  durationMs = DEFAULT_DURATION_MS,
  disabled = false,
  variant = 'default',
}: HoldToConfirmButtonProps) {
  const [holding, setHolding] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function start() {
    if (disabled || timerRef.current) return
    setHolding(true)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setHolding(false)
      onConfirm()
    }, durationMs)
  }

  function cancel() {
    setHolding(false)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
      e.preventDefault()
      start()
    }
  }

  function handleKeyUp(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Enter' || e.key === ' ') cancel()
  }

  const fillColor = variant === 'destructive' ? 'var(--status-critical)' : 'var(--primary)'

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      className="relative touch-none select-none overflow-hidden rounded-md border border-border/60 px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
      style={{ color: 'var(--foreground)' }}
    >
      <span
        aria-hidden
        className="absolute inset-0 origin-left"
        style={{
          background: fillColor,
          opacity: 0.35,
          transform: `scaleX(${holding ? 1 : 0})`,
          transition: holding ? `transform ${durationMs}ms linear` : 'transform 150ms ease-out',
        }}
      />
      <span className="relative">{children}</span>
    </button>
  )
}
