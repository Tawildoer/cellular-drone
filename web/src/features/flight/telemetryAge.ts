import { useEffect, useState } from 'react'
import { useVehicleStore } from '../../app/store-hooks'
import { useNow } from './useNow'

/** Telemetry normally arrives several times a second (WebRtcLink and the
 * mock: 10 Hz). A gap this long means the link is struggling or gone. */
export const TELEMETRY_STALE_MS = 3_000

/** How old the newest telemetry is, by this browser's clock; null before any. */
export function telemetryAgeMs(receivedAt: number | null, now: number): number | null {
  return receivedAt === null ? null : Math.max(0, now - receivedAt)
}

export function isStale(ageMs: number | null): boolean {
  return ageMs !== null && ageMs >= TELEMETRY_STALE_MS
}

/** Age of the newest telemetry, re-evaluated every half second. */
export function useTelemetryAge(): { ageMs: number | null; stale: boolean } {
  const receivedAt = useVehicleStore((s) => s.vehicleStateAt)
  const now = useNow(500)
  const ageMs = telemetryAgeMs(receivedAt, now)
  return { ageMs, stale: isStale(ageMs) }
}

/** Just whether telemetry is stale, for components that shouldn't re-render
 * on a clock: one timer per update, armed for when it would go stale, and
 * fresh again the moment the next update arrives. */
export function useTelemetryStale(): boolean {
  const receivedAt = useVehicleStore((s) => s.vehicleStateAt)
  const [staleAt, setStaleAt] = useState<number | null>(null)
  useEffect(() => {
    if (receivedAt === null) return
    const timer = setTimeout(() => setStaleAt(receivedAt), Math.max(0, receivedAt + TELEMETRY_STALE_MS - Date.now()))
    return () => clearTimeout(timer)
  }, [receivedAt])
  return receivedAt !== null && staleAt === receivedAt
}

