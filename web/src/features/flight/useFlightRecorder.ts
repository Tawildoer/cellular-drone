import { useEffect, useRef } from 'react'
import { useFlightLog, useVehicleStore } from '../../app/store-hooks'
import { IDLE_RECORDER, recordFlight, type FlightRecorder, type Mission } from '../../domain'

/**
 * Records each flight, takeoff to touchdown, into the flight log
 * (domain/flightRecord.ts). Runs while the flight screen is open, so it
 * captures what this operator watched; the drone keeps its own full log.
 */
export function useFlightRecorder(mission: Mission | null): void {
  const vehicleState = useVehicleStore((s) => s.vehicleState)
  const add = useFlightLog((s) => s.add)
  const refresh = useFlightLog((s) => s.refresh)
  const recorderRef = useRef<FlightRecorder>(IDLE_RECORDER)
  const missionRef = useRef(mission)

  useEffect(() => {
    missionRef.current = mission
  }, [mission])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!vehicleState) return
    const { recorder, finished } = recordFlight(recorderRef.current, vehicleState, missionRef.current, Date.now())
    recorderRef.current = recorder
    if (finished) void add(finished)
  }, [vehicleState, add])
}
