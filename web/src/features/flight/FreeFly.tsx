import { useEffect, useMemo, useRef, useState } from 'react'
import { useVehicleStore, useVehicleStoreApi } from '../../app/store-hooks'
import { HoldToConfirmButton } from '../../components/HoldToConfirmButton'
import { FREE_FLY_ALT_M, routeBattery, type GeoPoint, type Mission } from '../../domain'
import { RouteBatteryNote } from '../mission-planner/RouteBatteryNote'
import { useRouteWind } from './forecastWind'
import type { VehicleStoreState } from '../../state'

/** How long a refused free-fly action's message stays up. */
const NOTICE_MS = 4000

/**
 * Free fly (ADR-0024): taking over an airborne drone, and double-clicked
 * waypoints. `notice` says why something was refused, for a few seconds.
 */
export function useFreeFly() {
  const store = useVehicleStoreApi()
  const active = useVehicleStore((s) => !!s.vehicleState?.freeFly)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  async function start() {
    const result = await store.getState().send({ type: 'freefly.start', altM: FREE_FLY_ALT_M })
    setNotice(result.ok ? null : `Free fly refused: ${result.detail ?? result.reason}`)
  }

  async function addWaypoint(point: GeoPoint) {
    const result = await store.getState().send({ type: 'freefly.waypoint', lat: point.lat, lon: point.lon })
    setNotice(result.ok ? null : `Waypoint not added: ${result.detail ?? result.reason}`)
  }

  async function remove(index: number, at: GeoPoint) {
    const result = await store.getState().send({ type: 'freefly.remove', index, at })
    setNotice(result.ok ? null : `Waypoint not deleted: ${result.detail ?? result.reason}`)
  }

  async function setLoiter(index: number, at: GeoPoint, loiter: boolean) {
    const result = await store.getState().send({ type: 'freefly.loiter', index, at, loiter })
    setNotice(result.ok ? null : `Waypoint not changed: ${result.detail ?? result.reason}`)
  }

  return { active, start, addWaypoint, remove, setLoiter, notice }
}

/** Why free fly can't start now, or null if it can. */
function startBlockedReason(s: VehicleStoreState): string | null {
  const v = s.vehicleState
  if (s.connectionState !== 'connected' || !v) return 'Not connected'
  if (v.landed || !v.armed) return 'Free fly takes over a drone that is already flying'
  if (v.rc.overrideActive) return 'The RC pilot has control'
  if (v.flightMode === 'QLAND') return 'Landing'
  return null
}

/**
 * The top bar's free-fly control: hold to take over (a mode change, so it
 * needs the same deliberate hold as start and RTL). Once on, it just shows
 * that it's on: RTL or QLAND in the command bar ends it.
 */
export function FreeFlyButton({ className, active, onStart }: { className: string; active: boolean; onStart: () => void }) {
  const blocked = useVehicleStore(startBlockedReason)

  if (active) {
    return (
      <span
        className={`${className} inline-flex items-center !bg-[var(--primary)] text-[var(--primary-foreground)]`}
        title="Free fly is on. RTL or QLAND ends it."
      >
        Free fly
      </span>
    )
  }
  return (
    <span title={blocked ?? `Hold to take over in free fly at ${FREE_FLY_ALT_M} m`}>
      <HoldToConfirmButton className={className} onConfirm={onStart} disabled={blocked !== null}>
        Hold for free fly
      </HoldToConfirmButton>
    </span>
  )
}

/**
 * Whether the free-fly route still to fly, then home, fits the charge left
 * (ADR-0025). Recomputed as the aircraft moves; cheap.
 */
function useFreeFlyBattery() {
  const state = useVehicleStore((s) => s.vehicleState)
  const wind = useRouteWind()
  return useMemo(() => {
    const freeFly = state?.freeFly
    if (!state || !freeFly || !state.home) return null
    const rest = freeFly.waypoints.slice(state.missionProgress.currentIndex)
    const mission: Mission = {
      id: 'free-fly',
      name: 'Free fly',
      createdAt: 0,
      updatedAt: 0,
      items: [
        // Each loiter counts one lap; the circle at the end isn't counted
        // (it lasts until the next waypoint).
        ...rest.map((w) =>
          w.loiterRadiusM !== undefined
            ? { type: 'loiter' as const, lat: w.lat, lon: w.lon, altM: freeFly.altM, radiusM: w.loiterRadiusM, turns: 1 }
            : { type: 'waypoint' as const, lat: w.lat, lon: w.lon, altM: freeFly.altM },
        ),
        { type: 'returnToLaunch' as const },
      ],
    }
    const from = { point: state.position, altM: state.position.altRelM, fixedWing: state.vtolState === 'fw' }
    return routeBattery(mission, state.home, state.battery.percent, { from, wind })
  }, [state, wind])
}

/** While in free fly, how to use it, and when it's holding. */
export function FreeFlyBanner() {
  const altM = useVehicleStore((s) => s.vehicleState?.freeFly?.altM)
  const circling = useVehicleStore((s) => s.vehicleState?.freeFly?.circling ?? false)
  const battery = useFreeFlyBattery()
  if (altM === undefined) return null
  return (
    <div role="status" className="glass-panel flex flex-col gap-0.5 px-2.5 py-1.5">
      <span className="hud-label" style={{ color: 'var(--primary)' }}>
        Free fly at {altM} m{circling ? ' · circling until the next waypoint' : ''}
      </span>
      <span className="hud-label text-[0.5625rem]">Double-click the map: add a waypoint · Click: lock the gimbal · Click a waypoint: loiter or delete</span>
      {battery && <RouteBatteryNote battery={battery} subject="Finishing the route and getting home" />}
    </div>
  )
}

export interface WaypointMenuAnchor {
  index: number
  /** Client pixels where it was clicked. */
  x: number
  y: number
}

/**
 * A free-fly waypoint's menu, opened by clicking it on the map: make it a
 * loiter (or a plain waypoint again), or delete it. Closes on an action, a
 * click elsewhere or Escape. Flown waypoints can't be changed.
 */
export function WaypointMenu({
  anchor,
  onClose,
  onRemove,
  onSetLoiter,
}: {
  anchor: WaypointMenuAnchor
  onClose: () => void
  onRemove: (index: number, at: GeoPoint) => void
  onSetLoiter: (index: number, at: GeoPoint, loiter: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const waypoint = useVehicleStore((s) => s.vehicleState?.freeFly?.waypoints[anchor.index])
  const currentIndex = useVehicleStore((s) => s.vehicleState?.missionProgress.currentIndex ?? 0)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // Next tick, so the click that opened it doesn't close it.
    const timer = setTimeout(() => {
      window.addEventListener('pointerdown', onDown)
      window.addEventListener('keydown', onKey)
    })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Gone from the route (deleted, or free fly ended): nothing to show.
  useEffect(() => {
    if (!waypoint) onClose()
  }, [waypoint, onClose])
  if (!waypoint) return null

  const at = { lat: waypoint.lat, lon: waypoint.lon }
  const loiter = waypoint.loiterRadiusM !== undefined
  const flown = anchor.index < currentIndex
  const item = 'w-full rounded-md px-2.5 py-1.5 text-left text-xs transition hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Waypoint ${anchor.index + 1}`}
      className="glass-panel fixed z-50 flex w-44 flex-col gap-0.5 p-1"
      // Just below and right of the pointer, kept on screen.
      style={{ left: Math.min(anchor.x + 8, window.innerWidth - 184), top: Math.min(anchor.y + 8, window.innerHeight - 120) }}
    >
      <span className="hud-label px-2.5 pb-0.5 pt-1 text-[0.5625rem]">
        {loiter ? 'Loiter' : 'Waypoint'} {anchor.index + 1}
        {flown ? ' · flown' : ''}
      </span>
      <button
        type="button"
        role="menuitem"
        className={item}
        disabled={flown}
        onClick={() => {
          onSetLoiter(anchor.index, at, !loiter)
          onClose()
        }}
      >
        {loiter ? 'Make a plain waypoint' : 'Make a loiter'}
      </button>
      <button
        type="button"
        role="menuitem"
        className={`${item} text-[var(--destructive)]`}
        disabled={flown}
        onClick={() => {
          onRemove(anchor.index, at)
          onClose()
        }}
      >
        Delete
      </button>
    </div>
  )
}
