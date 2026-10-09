import { useEffect, useMemo, useRef, useState } from 'react'
import { useMissionStore, useVehicleStore } from '../../app/store-hooks'
import type { FreeFlyState, Mission } from '../../domain'
import type { VehicleStoreState } from '../../state'

/**
 * The mission shown to the checklist, command bar and map. While planning,
 * that's the draft being edited. Otherwise it's the mission the vehicle has
 * actually accepted — not the draft or the latest local save, which can
 * differ (unsaved edits, or an upload the vehicle rejected mid-flight) and
 * would otherwise draw a route the drone isn't flying. Falls back to the most
 * recent saved mission only while disconnected, when nothing is flying.
 *
 * In free fly (ADR-0024) it's the free-fly route the vehicle reports, as a
 * mission of plain waypoints, so the map and progress panel show it like any
 * other.
 *
 * The planned mission only shows while the drone is on it (missionActivity):
 * on the ground ready to start it, flying it in AUTO, paused in it, or on its
 * own closing RTL or landing. A commanded RTL or QLAND, free fly, and what
 * follows them (the vehicle puts the planned mission back after free fly)
 * show no mission, so nothing is drawn that the drone isn't flying.
 *
 * Separately, uploads that most-recent mission once on connect, so a mission
 * saved in an earlier session is ready to fly without reopening the planner.
 */
export function useFlightMission(planning: boolean): Mission | null {
  const missions = useMissionStore((s) => s.missions)
  const draft = useMissionStore((s) => s.draft)
  const refresh = useMissionStore((s) => s.refresh)

  const connectionState = useVehicleStore((s) => s.connectionState)
  const missionOnVehicle = useVehicleStore((s) => s.missionOnVehicle)
  const uploadMission = useVehicleStore((s) => s.uploadMission)
  const activity = useVehicleStore(missionActivity)
  // A pause keeps whatever it paused: on the mission, or not.
  const [onMission, setOnMission] = useState(true)
  const nowOnMission = activity === 'paused' ? onMission : activity === 'on'
  if (nowOnMission !== onMission) setOnMission(nowOnMission)
  // As a string so this only re-renders when the route changes, not on
  // every telemetry update.
  const freeFlyRoute = useVehicleStore((s) => {
    const freeFly = s.vehicleState?.freeFly
    return freeFly ? JSON.stringify({ altM: freeFly.altM, waypoints: freeFly.waypoints }) : null
  })
  const freeFlyMission = useMemo(() => (freeFlyRoute ? freeFlyAsMission(JSON.parse(freeFlyRoute)) : null), [freeFlyRoute])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const uploadedRef = useRef(false)
  useEffect(() => {
    if (uploadedRef.current || connectionState !== 'connected') return
    const mostRecent = missions[0]
    if (!mostRecent) return
    uploadedRef.current = true
    void uploadMission(mostRecent)
  }, [connectionState, missions, uploadMission])

  if (planning) return draft ?? missions[0] ?? null
  if (connectionState === 'connected') return freeFlyMission ?? (nowOnMission ? missionOnVehicle : null)
  return missions[0] ?? null
}

function freeFlyAsMission({ altM, waypoints }: Pick<FreeFlyState, 'altM' | 'waypoints'>): Mission {
  return {
    id: 'free-fly',
    name: 'Free fly',
    items: waypoints.map((w) =>
      w.loiterRadiusM !== undefined
        ? { type: 'loiter' as const, lat: w.lat, lon: w.lon, altM, radiusM: w.loiterRadiusM, turns: 1 }
        : { type: 'waypoint' as const, lat: w.lat, lon: w.lon, altM },
    ),
    createdAt: 0,
    updatedAt: 0,
  }
}

/**
 * Whether the vehicle is on its planned mission: 'on' (on the ground ready
 * for it, in AUTO, or on the mission's own closing RTL or landing item),
 * 'off' (a commanded RTL or QLAND, free fly, a pilot's mode) or 'paused'
 * (LOITER/QLOITER, which holds whichever it was). As a string so the hook
 * only re-renders when it changes.
 */
function missionActivity(s: VehicleStoreState): 'on' | 'off' | 'paused' {
  const v = s.vehicleState
  if (!v) return 'on'
  if (v.freeFly) return 'off'
  if (v.landed) return 'on'
  if (v.rc.overrideActive) return 'off'
  if (v.flightMode === 'AUTO') return 'on'
  if (v.flightMode === 'LOITER' || v.flightMode === 'QLOITER') return 'paused'
  // A mission's last RTL or landing item puts the FC (or the mock) in RTL or
  // QLAND: still the mission. Otherwise it was commanded, and isn't.
  const current = s.missionOnVehicle?.items[v.missionProgress.currentIndex]?.type
  if (v.flightMode === 'RTL' && current === 'returnToLaunch') return 'on'
  // (RTL ends in a vertical landing, QLAND in the mock.)
  if (v.flightMode === 'QLAND' && (current === 'vtolLand' || current === 'returnToLaunch')) return 'on'
  return 'off'
}
