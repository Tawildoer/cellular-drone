import { useState } from 'react'
import type { MockLink } from '../link/mock'

const MIN_TIME_SCALE = 1
const MAX_TIME_SCALE = 20
const MIN_LOOK_AHEAD_M = 5
const MAX_LOOK_AHEAD_M = 200

/**
 * Tuning for the in-browser simulated drone: speed up the sim and adjust the
 * L1 guidance look-ahead live, without editing code. Shown as the menu's
 * Simulator section only while connected to a MockLink (providers.tsx); a
 * real vehicle link has no such knobs.
 */
export function MockDevToolsPanel({ link }: { link: MockLink }) {
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

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs opacity-70">The demo drone is simulated in this browser. These change only the simulation.</p>
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
