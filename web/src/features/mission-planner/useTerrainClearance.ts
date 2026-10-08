import { useEffect, useMemo, useState } from 'react'
import { useTerrainService } from '../../app/store-hooks'
import {
  loiterRingPoints,
  sampleProfile,
  terrainClearance,
  type GeoPoint,
  type MissionProfile,
  type TerrainClearance,
} from '../../domain'

/** At most this many points per lookup, however long the route. */
const MAX_SAMPLES = 250
/** No finer than the terrain grid itself (~30 m). */
const MIN_SPACING_M = 30
/** Planner edits come in bursts (dragging, typing an altitude). */
const DEBOUNCE_MS = 400

export type TerrainState =
  /** No terrain source configured. */
  | { status: 'unavailable' }
  /** Nothing to look up: the route has no horizontal legs yet. */
  | { status: 'noRoute' }
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; clearance: TerrainClearance; description: string }

interface Result {
  key: string
  state: TerrainState
}

/**
 * Height above the terrain along the planned route, from the configured
 * TerrainService.
 * Pass a `home` that keeps its identity while it doesn't move (memoise it on
 * lat/lon): every new object restarts the lookup.
 */
export function useTerrainClearance(profile: MissionProfile | null, home: GeoPoint | null): TerrainState {
  const terrain = useTerrainService()
  const request = useMemo(() => {
    if (!profile || !home || profile.routeDistanceM <= 0) return null
    const samples = sampleProfile(profile, Math.max(MIN_SPACING_M, profile.routeDistanceM / MAX_SAMPLES))
    const rings = profile.loiters.map((loiter) => loiterRingPoints(loiter))
    return { samples, loiters: profile.loiters, rings, key: JSON.stringify([home, profile.vertices, profile.loiters]) }
  }, [profile, home])
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    if (!terrain || !request || !home) return
    const abort = new AbortController()
    const timer = setTimeout(() => {
      const points = [home, ...request.samples.map((s) => s.point), ...request.rings.flat()]
      terrain
        .elevationsM(points, abort.signal)
        .then((elevations) => {
          const [homeGround, ...rest] = elevations
          const sampleGround = rest.slice(0, request.samples.length)
          let next = request.samples.length
          const ringGround = request.rings.map((ring) => rest.slice(next, (next += ring.length)))
          const state: TerrainState =
            homeGround === null || homeGround === undefined
              ? { status: 'failed' }
              : {
                  status: 'ready',
                  clearance: terrainClearance(request.samples, sampleGround, request.loiters, ringGround, homeGround),
                  description: terrain.description,
                }
          setResult({ key: request.key, state })
        })
        .catch(() => {
          if (!abort.signal.aborted) setResult({ key: request.key, state: { status: 'failed' } })
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [terrain, request, home])

  if (!terrain) return { status: 'unavailable' }
  if (!request) return { status: 'noRoute' }
  return result?.key === request.key ? result.state : { status: 'loading' }
}
