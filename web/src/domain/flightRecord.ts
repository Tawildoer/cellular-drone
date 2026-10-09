import { haversineDistanceM } from './geo'
import type { Mission } from './mission'
import type { FlightMode, VehicleState } from './vehicle'

/** How a flight ended, judged from the last mode before touchdown. */
export type FlightOutcome =
  /** Flew the whole mission (in AUTO through its last item). */
  | 'completed'
  /** RTL commanded before the mission's end. */
  | 'returned'
  /** QLAND: landed where it was. */
  | 'landedHere'
  /** The RC pilot had control at touchdown (ADR-0008). */
  | 'pilot'
  | 'other'

/** One flight, takeoff to touchdown, as the browser saw it. */
export interface FlightRecord {
  id: string
  vehicleId: string
  missionId: string | null
  missionName: string | null
  /** Epoch ms, this browser's clock. */
  startedAt: number
  endedAt: number
  /** Ground distance flown (sum of telemetry positions). */
  distanceM: number
  maxAltM: number
  /** Furthest mission item reached, 0-based, and the mission's length. */
  furthestItem: number
  totalItems: number
  batteryStartPct: number
  batteryEndPct: number
  outcome: FlightOutcome
}

/** A flight in progress. */
interface Draft extends Omit<FlightRecord, 'id' | 'endedAt' | 'outcome'> {
  lastPoint: { lat: number; lon: number }
  lastMode: FlightMode
  rcOverride: boolean
}

export interface FlightRecorder {
  active: Draft | null
}

export const IDLE_RECORDER: FlightRecorder = { active: null }

/** Below this, a position change is GPS noise, not flying. */
const MIN_STEP_M = 1

function outcomeOf(draft: Draft): FlightOutcome {
  if (draft.rcOverride) return 'pilot'
  // Reached the mission's last item (an RTL or land item, which can report
  // as RTL mode while the FC flies it): the mission was flown through.
  const reachedEnd = draft.totalItems > 0 && draft.furthestItem >= draft.totalItems - 1
  if ((draft.lastMode === 'AUTO' || draft.lastMode === 'RTL') && reachedEnd) return 'completed'
  if (draft.lastMode === 'RTL') return 'returned'
  if (draft.lastMode === 'QLAND') return 'landedHere'
  return 'other'
}

/**
 * One telemetry update. A flight starts when the aircraft is armed and off
 * the ground, and ends at touchdown (`landed`), when the finished record is
 * returned. `mission` is the one the vehicle is flying, if known (same item
 * count as it reports), for its name and length.
 */
export function recordFlight(
  recorder: FlightRecorder,
  state: VehicleState,
  mission: Mission | null,
  nowMs: number,
  newId: () => string = () => crypto.randomUUID(),
): { recorder: FlightRecorder; finished: FlightRecord | null } {
  const point = { lat: state.position.lat, lon: state.position.lon }
  const active = recorder.active

  if (!active) {
    if (!state.armed || state.landed) return { recorder, finished: null }
    const known = mission !== null && mission.items.length === state.missionProgress.total ? mission : null
    return {
      recorder: {
        active: {
          vehicleId: state.vehicleId,
          missionId: known?.id ?? null,
          missionName: known?.name ?? null,
          startedAt: nowMs,
          distanceM: 0,
          maxAltM: Math.max(0, state.position.altRelM),
          furthestItem: state.missionProgress.currentIndex,
          totalItems: state.missionProgress.total,
          batteryStartPct: state.battery.percent,
          batteryEndPct: state.battery.percent,
          lastPoint: point,
          lastMode: state.flightMode,
          rcOverride: state.rc.overrideActive,
        },
      },
      finished: null,
    }
  }

  const stepM = haversineDistanceM(active.lastPoint, point)
  const moved = stepM >= MIN_STEP_M
  const next: Draft = {
    ...active,
    distanceM: active.distanceM + (moved ? stepM : 0),
    maxAltM: Math.max(active.maxAltM, state.position.altRelM),
    furthestItem: Math.max(active.furthestItem, state.missionProgress.currentIndex),
    batteryEndPct: state.battery.percent,
    lastPoint: moved ? point : active.lastPoint,
    // How it ended is judged from the last update in the air: on touchdown a
    // vehicle may report something less telling (the mock: UNKNOWN).
    lastMode: state.landed ? active.lastMode : state.flightMode,
    rcOverride: state.landed ? active.rcOverride : state.rc.overrideActive,
  }

  if (!state.landed) return { recorder: { active: next }, finished: null }

  const { lastPoint: _point, lastMode: _mode, rcOverride: _rc, ...kept } = next
  return {
    recorder: IDLE_RECORDER,
    finished: { ...kept, id: newId(), endedAt: nowMs, outcome: outcomeOf(next) },
  }
}

export const FLIGHT_OUTCOME_LABEL: Record<FlightOutcome, string> = {
  completed: 'Completed',
  returned: 'Returned home early',
  landedHere: 'Landed in place (QLAND)',
  pilot: 'RC pilot took over',
  other: 'Ended',
}
