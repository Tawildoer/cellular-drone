import { useEffect, useRef } from 'react'
import { useCoverage, useVehicleStore } from '../../app/store-hooks'
import { haversineDistanceM, type GeoPoint } from '../../domain'

/** A new reading once the drone has moved this far: the coverage map keeps
 * one per ~30 m square anyway (domain/pathColor.ts). */
const MIN_SPACING_M = 15

/**
 * Records the modem's signal along every flight into the coverage map, so
 * the planned route can be coloured by what earlier flights measured. Runs
 * while the flight screen is open, whatever the path colour setting.
 */
export function useCoverageRecorder(): void {
  const vehicleState = useVehicleStore((s) => s.vehicleState)
  const add = useCoverage((s) => s.add)
  const load = useCoverage((s) => s.load)
  const lastRef = useRef<GeoPoint | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const cell = vehicleState?.cellular
    if (!vehicleState || !cell || !vehicleState.armed || vehicleState.landed || vehicleState.gps.fixType === 'none') return
    const point = { lat: vehicleState.position.lat, lon: vehicleState.position.lon }
    if (lastRef.current && haversineDistanceM(lastRef.current, point) < MIN_SPACING_M) return
    lastRef.current = point
    add({ ...point, altM: vehicleState.position.altRelM, rsrpDbm: cell.rsrpDbm, sinrDb: cell.sinrDb, atMs: Date.now() })
  }, [vehicleState, add])
}
