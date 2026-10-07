import { Activity, X } from 'lucide-react'
import { useState } from 'react'
import { LinkQualityPanel } from './LinkQualityPanel'

const TOGGLE_SIZE = 'h-9 w-9'

/** Same pattern as EventLogPopout: a small toggle that opens the panel, with
 * the close button in the toggle's exact spot. The panel's history keeps
 * accumulating while closed (it lives in the vehicle store), so opening it
 * mid-flight shows the last minute, not an empty chart. */
export function LinkQualityPopout() {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Show link quality"
        className={`glass-panel flex ${TOGGLE_SIZE} items-center justify-center transition hover:ring-2 hover:ring-primary`}
      >
        <Activity size={14} style={{ color: 'var(--primary)' }} aria-hidden />
      </button>
    )
  }

  return (
    <div className="relative">
      <LinkQualityPanel />
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Hide link quality"
        className={`absolute left-0 top-0 z-10 flex ${TOGGLE_SIZE} items-center justify-center transition hover:bg-white/5`}
      >
        <X size={14} style={{ color: 'var(--primary)' }} aria-hidden />
      </button>
    </div>
  )
}
