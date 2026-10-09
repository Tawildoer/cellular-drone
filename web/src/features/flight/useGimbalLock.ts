import { useEffect, useState } from 'react'
import { useVehicleStoreApi } from '../../app/store-hooks'
import { GIMBAL_LOCK_RANGE_M, haversineDistanceM, type GeoPoint } from '../../domain'

/** How long a refused lock's message stays up. */
const NOTICE_MS = 4000

/**
 * A map click outside planning locks the gimbal onto that spot (ADR-0023),
 * if it's within GIMBAL_LOCK_RANGE_M of the aircraft. The vehicle checks the
 * range too, and releases the lock itself once out of range. `notice` says
 * why a click didn't lock, for a few seconds.
 */
export function useGimbalLock() {
  const store = useVehicleStoreApi()
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  async function lockAt(point: GeoPoint, groundElevationM: number | null) {
    const { vehicleState, send } = store.getState()
    if (!vehicleState) return
    const distanceM = haversineDistanceM(vehicleState.position, point)
    if (distanceM > GIMBAL_LOCK_RANGE_M) {
      setNotice(`Out of gimbal range: ${Math.round(distanceM)} m from the drone (max ${GIMBAL_LOCK_RANGE_M} m)`)
      return
    }
    // Without terrain (or before its tile loads), assume the spot is level
    // with home. Never NaN: JSON turns it into null and the command fails.
    const altAmslM =
      groundElevationM !== null && Number.isFinite(groundElevationM) ? groundElevationM : (vehicleState.home?.altAmslM ?? 0)
    const result = await send({ type: 'gimbal.lock', target: { lat: point.lat, lon: point.lon, altAmslM } })
    setNotice(result.ok ? null : `Gimbal didn't lock: ${result.detail ?? result.reason}`)
  }

  async function release() {
    const result = await store.getState().send({ type: 'gimbal.release' })
    setNotice(result.ok ? null : `Gimbal didn't release: ${result.detail ?? result.reason}`)
  }

  return { lockAt, release, notice }
}
