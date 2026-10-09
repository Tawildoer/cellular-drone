import { useVehicleStore } from '../../app/store-hooks'
import {
  missionItemLabel,
  remainingMission,
  returnHomeEstimate,
  type Mission,
  type ProfileStart,
  type VehicleState,
} from '../../domain'
import { formatDistance, formatDuration } from '../mission-planner/profileFormat'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="hud-label w-14 shrink-0">{label}</span>
      <span className="hud-value truncate text-xs">{value}</span>
    </div>
  )
}

function aircraftOf(state: VehicleState): ProfileStart {
  return {
    point: { lat: state.position.lat, lon: state.position.lon },
    altM: Math.max(0, state.position.altRelM),
    fixedWing: state.vtolState === 'fw',
  }
}

/** "Item 3/7 · Waypoint · 420 m", or the climb for a takeoff. */
function currentItemText(mission: Mission, state: VehicleState, toCurrentM: number | null): string {
  const index = state.missionProgress.currentIndex
  const item = mission.items[index]
  const head = `${index + 1}/${mission.items.length}`
  if (!item) return head
  const label = missionItemLabel(item)
  if (item.type === 'vtolTakeoff') return `${head} · ${label} · climbing to ${item.altM} m`
  return toCurrentM === null ? `${head} · ${label}` : `${head} · ${label} · ${formatDistance(toCurrentM)}`
}

/**
 * Where the flight is up to, while armed: the item being flown and how far
 * it is, what's left of the mission, and the way home. Estimates use the
 * planner's ArduPlane figures (domain/missionProfile.ts), not the current
 * ground speed, which swings with wind and turns. Only shown for the mission
 * the vehicle reports flying (same item count), so a stale or different
 * plan can't produce a confident wrong answer.
 */
export function MissionProgressPanel({ mission }: { mission: Mission | null }) {
  const state = useVehicleStore((s) => s.vehicleState)
  if (!state?.armed) return null

  const home = state.home ? { lat: state.home.lat, lon: state.home.lon } : null
  const aircraft = aircraftOf(state)
  const mode = state.flightMode
  const paused = mode === 'LOITER' || mode === 'QLOITER'
  const matches = mission !== null && mission.items.length === state.missionProgress.total
  const toHome = home ? returnHomeEstimate(aircraft, home) : null
  const homeText = toHome ? `${formatDistance(toHome.distanceM)} · ~${formatDuration(toHome.durationS)}` : 'unknown'

  if (mode === 'RTL' || mode === 'QLAND') {
    return (
      <div className="glass-panel flex w-72 flex-col gap-0.5 px-2.5 py-1.5" aria-label="Flight progress">
        <Row label="Now" value={mode === 'RTL' ? 'Returning home' : 'Landing here'} />
        {mode === 'RTL' && <Row label="Home" value={homeText} />}
      </div>
    )
  }

  const remaining =
    matches && home ? remainingMission(mission, state.missionProgress.currentIndex, aircraft, home) : null

  return (
    <div className="glass-panel flex w-72 flex-col gap-0.5 px-2.5 py-1.5" aria-label="Flight progress">
      {matches ? (
        <Row label={paused ? 'Paused' : 'Item'} value={currentItemText(mission, state, remaining?.toCurrentM ?? null)} />
      ) : (
        <Row label={paused ? 'Paused' : 'Item'} value={`${state.missionProgress.currentIndex + 1}/${state.missionProgress.total}`} />
      )}
      {remaining && (
        <Row
          label="Left"
          value={`${remaining.isMinimum ? '≥ ' : '~'}${formatDuration(remaining.remainingS)} · ${formatDistance(remaining.remainingM)}`}
        />
      )}
      <Row label="Home" value={homeText} />
    </div>
  )
}
