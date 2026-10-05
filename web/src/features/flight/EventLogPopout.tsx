import { ScrollText, X } from 'lucide-react'
import { useState } from 'react'
import { EventLog } from './EventLog'

const TOGGLE_SIZE = 'h-9 w-9'

/** Collapsed by default — a small floating toggle, not a fixed panel eating
 * map space. The close button sits at the exact same position and size as
 * the toggle that opened it, so the cursor is already on it — no need to
 * move the mouse to close what you just opened. */
export function EventLogPopout() {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Show event log"
        className={`glass-panel flex ${TOGGLE_SIZE} items-center justify-center transition hover:ring-2 hover:ring-primary`}
      >
        <ScrollText size={14} style={{ color: 'var(--primary)' }} aria-hidden />
      </button>
    )
  }

  return (
    <div className="relative h-[28vh] w-64">
      <EventLog />
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Hide event log"
        className={`absolute left-0 top-0 z-10 flex ${TOGGLE_SIZE} items-center justify-center transition hover:bg-white/5`}
      >
        <X size={14} style={{ color: 'var(--primary)' }} aria-hidden />
      </button>
    </div>
  )
}
