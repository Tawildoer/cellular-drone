import { useState } from 'react'
import { useFlightLog } from '../../app/store-hooks'
import { FLIGHT_OUTCOME_LABEL, type FlightOutcome, type FlightRecord } from '../../domain'
import { formatDistance, formatDuration } from '../mission-planner/profileFormat'

const OUTCOME_COLOR: Record<FlightOutcome, string> = {
  completed: 'var(--status-good)',
  returned: 'var(--status-warning)',
  landedHere: 'var(--status-warning)',
  pilot: 'var(--status-warning)',
  other: 'var(--muted-foreground)',
}

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="hud-label text-[0.5625rem]">{label}</span>
      <span className="hud-value text-xs">{value}</span>
    </div>
  )
}

function FlightCard({ flight }: { flight: FlightRecord }) {
  const color = OUTCOME_COLOR[flight.outcome]
  return (
    <li className="flex flex-col gap-1.5 border-b border-border/60 px-2.5 py-2 last:border-b-0">
      <div className="flex items-baseline gap-2">
        <span className="truncate text-xs font-medium" style={{ color: 'var(--foreground)' }}>
          {flight.missionName ?? 'Unplanned flight'}
        </span>
        <span className="flex-1" />
        <span className="hud-label shrink-0">{when(flight.startedAt)}</span>
      </div>
      <span
        className="hud-label w-fit rounded-full px-2 py-0.5"
        style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}
      >
        {FLIGHT_OUTCOME_LABEL[flight.outcome]}
      </span>
      <div className="grid grid-cols-3 gap-x-2 gap-y-1">
        <Stat label="Duration" value={formatDuration((flight.endedAt - flight.startedAt) / 1000)} />
        <Stat label="Distance" value={formatDistance(flight.distanceM)} />
        <Stat label="Max alt" value={`${Math.round(flight.maxAltM)} m`} />
        <Stat label="Items" value={flight.totalItems > 0 ? `${flight.furthestItem + 1}/${flight.totalItems}` : '—'} />
        <Stat label="Battery" value={`${Math.round(flight.batteryStartPct)}→${Math.round(flight.batteryEndPct)}%`} />
      </div>
    </li>
  )
}

/**
 * Past flights, takeoff to touchdown, newest first (useFlightRecorder): the
 * stats the progress panel showed in flight, kept for review once it's gone.
 */
export function FlightLogPanel() {
  const [confirmClear, setConfirmClear] = useState(false)
  const records = useFlightLog((s) => s.records)
  const clear = useFlightLog((s) => s.clear)

  if (records.length === 0) {
    return <p className="text-xs opacity-70">No flights yet. Each flight is logged here from takeoff to landing.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end gap-2">
        {confirmClear ? (
          <>
            <span className="hud-label">Delete all?</span>
            <button
              type="button"
              onClick={() => void clear().then(() => setConfirmClear(false))}
              className="hud-label transition hover:opacity-70"
              style={{ color: 'var(--status-critical)' }}
            >
              Yes
            </button>
            <button type="button" onClick={() => setConfirmClear(false)} className="hud-label transition hover:opacity-70">
              No
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmClear(true)} className="hud-label transition hover:opacity-70">
            Clear
          </button>
        )}
      </div>
      <ul className="-mx-2.5 flex flex-col">
        {records.map((flight) => (
          <FlightCard key={flight.id} flight={flight} />
        ))}
      </ul>
    </div>
  )
}
