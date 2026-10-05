import { Wrench, X } from 'lucide-react'
import { useState } from 'react'
import type { MockLink } from '../link/mock'

const TOGGLE_SIZE = 'h-9 w-9'
const MIN_TIME_SCALE = 1
const MAX_TIME_SCALE = 20
const MIN_LOOK_AHEAD_M = 5
const MAX_LOOK_AHEAD_M = 200

/**
 * Dev-only tuning panel for the mock simulated drone — speed up the sim and
 * adjust the L1 guidance look-ahead distance live, without editing code and
 * rebuilding. Only ever rendered when VITE_VEHICLE_LINK is the mock (see
 * providers.tsx) — a real vehicle link has no such knobs.
 */
export function MockDevTools({ link }: { link: MockLink }) {
  const [open, setOpen] = useState(false)
  const [timeScale, setTimeScaleValue] = useState(() => link.getTimeScale())
  const [lookAheadM, setLookAheadMValue] = useState(() => link.getFaultConfig().lookAheadM)

  function handleTimeScale(value: number) {
    link.setTimeScale(value)
    setTimeScaleValue(value)
  }

  function handleLookAhead(value: number) {
    link.setFaultConfig({ lookAheadM: value })
    setLookAheadMValue(value)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Show dev tools"
        className={`glass-panel fixed bottom-4 left-1/2 z-50 flex ${TOGGLE_SIZE} -translate-x-1/2 items-center justify-center transition hover:ring-2 hover:ring-primary`}
      >
        <Wrench size={14} style={{ color: 'var(--primary)' }} aria-hidden />
      </button>
    )
  }

  return (
    <div className="glass-panel fixed bottom-4 left-1/2 z-50 flex w-72 -translate-x-1/2 flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <span className="hud-label">Dev tools — mock drone</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Hide dev tools" className="transition hover:opacity-70">
          <X size={14} style={{ color: 'var(--primary)' }} aria-hidden />
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="hud-label flex items-center justify-between">
          <span>Sim speed</span>
          <span>{timeScale}×</span>
        </span>
        <input
          type="range"
          min={MIN_TIME_SCALE}
          max={MAX_TIME_SCALE}
          step={1}
          value={timeScale}
          onChange={(e) => handleTimeScale(Number(e.target.value))}
          aria-label="Simulation speed multiplier"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="hud-label flex items-center justify-between">
          <span>Look-ahead distance</span>
          <span>{lookAheadM}m</span>
        </span>
        <input
          type="range"
          min={MIN_LOOK_AHEAD_M}
          max={MAX_LOOK_AHEAD_M}
          step={5}
          value={lookAheadM}
          onChange={(e) => handleLookAhead(Number(e.target.value))}
          aria-label="Guidance look-ahead distance, meters"
        />
      </label>
    </div>
  )
}
