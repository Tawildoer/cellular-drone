import { House, MapPin, PlaneLanding, PlaneTakeoff, RotateCw, type LucideIcon } from 'lucide-react'
import { useVehicleStore } from '../../app/store-hooks'
import {
  haversineDistanceM,
  itemPosition,
  missionItemLabel,
  remainingMission,
  returnHomeEstimate,
  type GeoPoint,
  type Mission,
  type MissionItem,
  type ProfileStart,
  type VehicleState,
} from '../../domain'
import { formatDistance, formatDuration } from '../mission-planner/profileFormat'

type Phase = { label: string; color: string }

const FLYING: Phase = { label: 'Flying', color: 'var(--primary)' }
const PAUSED: Phase = { label: 'Paused', color: 'var(--status-warning)' }
const RETURNING: Phase = { label: 'Returning home', color: 'var(--primary)' }
const LANDING: Phase = { label: 'Landing', color: 'var(--primary)' }

const ITEM_ICON: Record<MissionItem['type'], LucideIcon> = {
  vtolTakeoff: PlaneTakeoff,
  waypoint: MapPin,
  loiter: RotateCw,
  vtolLand: PlaneLanding,
  returnToLaunch: House,
}

function aircraftOf(state: VehicleState): ProfileStart {
  return {
    point: { lat: state.position.lat, lon: state.position.lon },
    altM: Math.max(0, state.position.altRelM),
    fixedWing: state.vtolState === 'fw',
  }
}

function PhaseChip({ phase }: { phase: Phase }) {
  return (
    <span
      className="hud-label shrink-0 rounded-full px-2 py-0.5"
      style={{ color: phase.color, background: `color-mix(in srgb, ${phase.color} 15%, transparent)` }}
    >
      {phase.label}
    </span>
  )
}

/**
 * One segment per mission item: done ones filled, the current one filling
 * as the aircraft closes on it. Reads as "how far through the plan", which
 * a distance bar can't when a long loiter dominates the distance.
 */
function ItemProgress({ total, current, fraction }: { total: number; current: number; fraction: number }) {
  return (
    <div className="flex flex-1 gap-[2px]" role="img" aria-label={`Item ${current + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => {
        const fill = i < current ? 1 : i === current ? fraction : 0
        return (
          <span key={i} className="relative h-1.5 flex-1 overflow-hidden rounded-[2px]" style={{ background: 'var(--accent)' }}>
            <span
              className="absolute inset-y-0 left-0 rounded-[2px] transition-[width] duration-500"
              style={{ width: `${Math.round(fill * 100)}%`, background: 'var(--primary)' }}
            />
          </span>
        )
      })}
    </div>
  )
}

/** A big figure with a smaller one under it. */
function Figure({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 py-1.5">
      <span className="hud-label">{label}</span>
      <span className="hud-value text-base leading-tight">{value}</span>
      <span className="hud-label text-[0.625rem]">{detail}</span>
    </div>
  )
}

/** How far along the leg into the current item the aircraft is, 0–1. */
function legFraction(mission: Mission, index: number, toCurrentM: number, home: GeoPoint | null): number {
  const target = mission.items[index]
  if (!target) return 0
  const to = target.type === 'returnToLaunch' ? home : itemPosition(target)
  const from = mission.items
    .slice(0, index)
    .reverse()
    .map(itemPosition)
    .find((p): p is GeoPoint => p !== null) ?? home
  if (!to || !from) return 0
  const legM = haversineDistanceM(from, to)
  return legM > 0 ? Math.min(1, Math.max(0, 1 - toCurrentM / legM)) : 0
}

/**
 * Where the flight is up to, while armed: the mission and its state, how far
 * through the plan, what's being flown to, and time and distance left and
 * home. Estimates use the planner's ArduPlane figures (domain/missionProfile)
 * rather than the current ground speed, which swings with wind and turns.
 * Only estimates for the mission the vehicle reports flying (same item
 * count): otherwise the figures are dashes, not a confident wrong answer.
 */
export function MissionProgressPanel({ mission }: { mission: Mission | null }) {
  const state = useVehicleStore((s) => s.vehicleState)
  if (!state?.armed) return null

  const home = state.home ? { lat: state.home.lat, lon: state.home.lon } : null
  const aircraft = aircraftOf(state)
  const mode = state.flightMode
  const { currentIndex, total } = state.missionProgress
  const known = mission !== null && mission.items.length === total ? mission : null
  const toHome = home ? returnHomeEstimate(aircraft, home) : null

  const phase = mode === 'RTL' ? RETURNING : mode === 'QLAND' ? LANDING : mode === 'LOITER' || mode === 'QLOITER' ? PAUSED : FLYING
  const offMission = phase === RETURNING || phase === LANDING
  const remaining = !offMission && known && home ? remainingMission(known, currentIndex, aircraft, home) : null
  const item = known?.items[currentIndex]

  // What it's flying to, and how far: home on RTL, the spot below on QLAND.
  let TargetIcon: LucideIcon = MapPin
  let target = `Item ${currentIndex + 1}`
  let targetDetail = ''
  if (phase === RETURNING) {
    TargetIcon = House
    target = 'Home'
    targetDetail = toHome ? formatDistance(toHome.distanceM) : ''
  } else if (phase === LANDING) {
    TargetIcon = PlaneLanding
    target = 'Landing here'
  } else if (item) {
    TargetIcon = ITEM_ICON[item.type]
    target = `${missionItemLabel(item)} ${currentIndex + 1}`
    targetDetail = item.type === 'vtolTakeoff' ? `climbing to ${item.altM} m` : remaining ? formatDistance(remaining.toCurrentM) : ''
  }

  return (
    <section className="glass-panel flex w-72 flex-col overflow-hidden" aria-label="Flight progress">
      <div className="flex flex-col gap-1.5 px-2.5 pb-2 pt-1.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium" style={{ color: 'var(--foreground)' }}>
            {known?.name ?? 'Mission'}
          </span>
          <span className="flex-1" />
          <PhaseChip phase={phase} />
        </div>

        {!offMission && total > 0 && (
          <div className="flex items-center gap-2">
            <ItemProgress
              total={total}
              current={currentIndex}
              fraction={known && remaining ? legFraction(known, currentIndex, remaining.toCurrentM, home) : 0}
            />
            <span className="hud-label shrink-0">
              {currentIndex + 1} of {total}
            </span>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--foreground)' }}>
          <TargetIcon size={13} style={{ color: 'var(--primary)' }} aria-hidden className="shrink-0" />
          <span className="truncate">{target}</span>
          <span className="flex-1" />
          <span className="hud-value shrink-0 text-xs">{targetDetail}</span>
        </div>
      </div>

      <div className="flex divide-x divide-border/60 border-t border-border/60">
        {!offMission && (
          <Figure
            label="Mission left"
            value={remaining ? `${remaining.isMinimum ? '≥ ' : ''}${formatDuration(remaining.remainingS)}` : '—'}
            detail={remaining ? formatDistance(remaining.remainingM) : known ? '—' : 'not the vehicle’s mission'}
          />
        )}
        <Figure
          label="To home"
          value={toHome ? formatDuration(toHome.durationS) : '—'}
          detail={toHome ? formatDistance(toHome.distanceM) : 'home unknown'}
        />
      </div>
    </section>
  )
}
