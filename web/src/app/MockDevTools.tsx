import { useState, type ReactNode } from 'react'
import type { FailsafeFaultConfig, FaultInjectionConfig, MockLink } from '../link/mock'

const MIN_TIME_SCALE = 1
const MAX_TIME_SCALE = 20
const MIN_LOOK_AHEAD_M = 5
const MAX_LOOK_AHEAD_M = 200
const MAX_LATENCY_MS = 3000
const MAX_LOSS_PCT = 90
const MAX_WIND_MPS = 20

const FAILSAFES: { key: keyof FailsafeFaultConfig; label: string }[] = [
  { key: 'gcs', label: 'Ground station' },
  { key: 'battery', label: 'Battery' },
  { key: 'geofence', label: 'Geofence' },
  { key: 'rc', label: 'RC' },
]

/** Faults back to none; the guidance tuning and wobble are left alone. */
const NO_FAULTS: Partial<FaultInjectionConfig> = {
  latencyMs: 0,
  lossRate: 0,
  linkDropped: false,
  rcOverrideActive: false,
  lowBattery: false,
  failsafe: { gcs: false, battery: false, geofence: false, rc: false },
  wind: { speedMps: 0, directionDeg: 0 },
}

/**
 * Tuning and fault injection for the in-browser simulated drone: speed up
 * the sim and adjust the L1 guidance look-ahead live, and make things go
 * wrong on purpose (a slow or lossy link, the link dropping, the RC pilot
 * taking over, a low battery, failsafes, wind) to see how the console
 * copes, without editing code. Shown as the menu's Simulator section only
 * while connected to a MockLink (providers.tsx); a real vehicle link has no
 * such knobs.
 */
export function MockDevToolsPanel({ link }: { link: MockLink }) {
  const [timeScale, setTimeScaleValue] = useState(() => link.getTimeScale())
  const [fault, setFault] = useState(() => link.getFaultConfig())

  function handleTimeScale(value: number) {
    link.setTimeScale(value)
    setTimeScaleValue(value)
  }

  function change(partial: Partial<FaultInjectionConfig>) {
    link.setFaultConfig(partial)
    setFault(link.getFaultConfig())
  }

  const anyFault =
    fault.latencyMs > 0 ||
    fault.lossRate > 0 ||
    fault.linkDropped ||
    fault.rcOverrideActive ||
    fault.lowBattery ||
    Object.values(fault.failsafe).some(Boolean) ||
    fault.wind.speedMps > 0

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs opacity-70">The demo drone is simulated in this browser. These change only the simulation.</p>

      <Group title="Simulation">
        <Slider
          label="Sim speed"
          value={timeScale}
          display={`${timeScale}×`}
          min={MIN_TIME_SCALE}
          max={MAX_TIME_SCALE}
          step={1}
          onChange={handleTimeScale}
          aria="Simulation speed multiplier"
        />
        <Slider
          label="Look-ahead distance"
          value={fault.lookAheadM}
          display={`${fault.lookAheadM}m`}
          min={MIN_LOOK_AHEAD_M}
          max={MAX_LOOK_AHEAD_M}
          step={5}
          onChange={(v) => change({ lookAheadM: v })}
          aria="Guidance look-ahead distance, meters"
        />
      </Group>

      <Group title="Link">
        <Toggle label="Drop the link" on={fault.linkDropped} onChange={(on) => change({ linkDropped: on })} />
        <Slider
          label="Added delay"
          value={fault.latencyMs}
          display={`${fault.latencyMs} ms`}
          min={0}
          max={MAX_LATENCY_MS}
          step={50}
          onChange={(v) => change({ latencyMs: v })}
          aria="Added delay on telemetry and commands, milliseconds"
        />
        <Slider
          label="Telemetry lost"
          value={Math.round(fault.lossRate * 100)}
          display={`${Math.round(fault.lossRate * 100)}%`}
          min={0}
          max={MAX_LOSS_PCT}
          step={5}
          onChange={(v) => change({ lossRate: v / 100 })}
          aria="Share of telemetry updates lost, percent"
        />
      </Group>

      <Group title="Aircraft">
        <Toggle label="RC pilot takes over" on={fault.rcOverrideActive} onChange={(on) => change({ rcOverrideActive: on })} />
        <Toggle label="Low battery" on={fault.lowBattery} onChange={(on) => change({ lowBattery: on })} />
      </Group>

      <Group title="Failsafes">
        <div className="grid grid-cols-2 gap-1.5">
          {FAILSAFES.map(({ key, label }) => (
            <Toggle
              key={key}
              label={label}
              on={fault.failsafe[key]}
              onChange={(on) => change({ failsafe: { ...fault.failsafe, [key]: on } })}
            />
          ))}
        </div>
      </Group>

      <Group title="Wind">
        <Slider
          label="Speed"
          value={fault.wind.speedMps}
          display={`${fault.wind.speedMps} m/s`}
          min={0}
          max={MAX_WIND_MPS}
          step={1}
          onChange={(v) => change({ wind: { ...fault.wind, speedMps: v } })}
          aria="Simulated wind speed, metres per second"
        />
        <Slider
          label="From"
          value={fault.wind.directionDeg}
          display={`${fault.wind.directionDeg}°`}
          min={0}
          max={355}
          step={5}
          onChange={(v) => change({ wind: { ...fault.wind, directionDeg: v } })}
          aria="Direction the simulated wind blows from, degrees"
        />
      </Group>

      <button
        type="button"
        disabled={!anyFault}
        onClick={() => change(NO_FAULTS)}
        className="hud-label rounded-md border px-2.5 py-1.5 transition hover:ring-2 hover:ring-primary disabled:opacity-40 disabled:hover:ring-0"
      >
        Clear all faults
      </button>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="hud-label" style={{ color: 'var(--primary)' }}>
        {title}
      </h3>
      {children}
    </section>
  )
}

function Slider({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  aria,
}: {
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  aria: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="hud-label flex items-center justify-between">
        <span>{label}</span>
        <span className="tabular-nums">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={aria}
      />
    </label>
  )
}

/** On/off, showing which it is in words as well as colour. */
function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="hud-label flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left transition hover:ring-2 hover:ring-primary"
      style={
        on
          ? { color: 'var(--status-warning)', background: 'color-mix(in srgb, var(--status-warning) 14%, transparent)' }
          : { background: 'var(--accent)' }
      }
    >
      <span>{label}</span>
      <span className="tabular-nums">{on ? 'On' : 'Off'}</span>
    </button>
  )
}
