import { useEffect, useRef } from 'react'
import { useMissionStore, useVehicleStore } from '../../app/store-hooks'
import type { Mission } from '../../domain'

/**
 * The mission shown to the checklist, command bar and map. While planning,
 * that's the draft being edited. Otherwise it's the mission the vehicle has
 * actually accepted — not the draft or the latest local save, which can
 * differ (unsaved edits, or an upload the vehicle rejected mid-flight) and
 * would otherwise draw a route the drone isn't flying. Falls back to the most
 * recent saved mission only while disconnected, when nothing is flying.
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
  if (connectionState === 'connected') return missionOnVehicle
  return missions[0] ?? null
}
