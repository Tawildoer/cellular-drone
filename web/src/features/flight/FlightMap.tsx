import { Map as MaplibreMap, Marker, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, Polygon } from 'geojson'
import { LocateFixed } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useVehicleStore } from '../../app/store-hooks'
import type { GeoPoint, Mission, VehicleState } from '../../domain'
import {
  appendTrailPoint,
  buildAircraftMarkerGeoJson,
  buildFenceGeoJson,
  buildFloatingTrailGeoJson,
  buildMissionFloatingPathGeoJson,
  buildMissionLoiterRingsGeoJson,
  buildMissionWaypointMarkersGeoJson,
  isLappingCurrentLoiter,
  type AircraftPose,
  type AltitudePoint,
} from './flightMapGeo'

const STREET_LAYER = 'street'
const SATELLITE_LAYER = 'satellite'
const BUILDINGS_SOURCE = 'maptiler-planet'
const BUILDINGS_LAYER = '3d-buildings'
const TERRAIN_SOURCE = 'maptiler-terrain'
const HILLSHADE_LAYER = 'hillshade'

const MAPTILER_KEY = typeof import.meta.env.VITE_MAPTILER_KEY === 'string' ? import.meta.env.VITE_MAPTILER_KEY : undefined

/**
 * Both basemaps load at once and the toggle just flips layer visibility —
 * never `map.setStyle()`, which would wipe our own trail/mission-path/fence
 * sources and require re-adding them on every switch.
 *
 * Satellite (Esri World Imagery) and the street tiles are both free/keyless.
 * 3D buildings and terrain (real elevation — hills actually displace the
 * ground mesh, plus a hillshade layer for shading even before tilting the
 * camera) need a MapTiler key (docs/DECISIONS.md) — both are simply omitted
 * if VITE_MAPTILER_KEY isn't set. Exaggeration is deliberately 1 (true
 * scale) rather than boosted — this is an operational tool, not a scenic
 * map, so a hill should look exactly as tall as it actually is.
 */
function buildMapStyle(): StyleSpecification {
  const sources: StyleSpecification['sources'] = {
    // CARTO's Dark Matter looked right but turned out to require an API key
    // now (not actually keyless) — back to OSM's keyless tiles, fully
    // desaturated below instead (see STREET_LAYER paint).
    street: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Esri, Maxar, Earthstar Geographics',
    },
  }

  const layers: StyleSpecification['layers'] = [
    {
      id: STREET_LAYER,
      type: 'raster',
      source: 'street',
      // Fully desaturated (-1, not the old -0.85 which still left 15% of
      // OSM's cream/beige chroma showing through — that residual was
      // exactly the "beige tinge") so it's true neutral gray, then darkened
      // for a low-profile tactical look, with a bit of extra contrast to
      // keep roads/water/parks distinguishable now that they're only
      // separated by shade, not hue.
      paint: {
        'raster-saturation': -1,
        'raster-brightness-max': 0.35,
        'raster-contrast': 0.2,
      },
    },
    {
      id: SATELLITE_LAYER,
      type: 'raster',
      source: 'satellite',
      layout: { visibility: 'none' },
    },
  ]

  if (MAPTILER_KEY) {
    sources[BUILDINGS_SOURCE] = {
      type: 'vector',
      tiles: [`https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key=${MAPTILER_KEY}`],
      minzoom: 0,
      maxzoom: 14,
    }
    layers.push({
      id: BUILDINGS_LAYER,
      type: 'fill-extrusion',
      source: BUILDINGS_SOURCE,
      'source-layer': 'building',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': '#3a4a56',
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 5],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.85,
      },
    })

    sources[TERRAIN_SOURCE] = {
      type: 'raster-dem',
      tiles: [`https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=${MAPTILER_KEY}`],
      tileSize: 256,
      encoding: 'mapbox',
      maxzoom: 12,
    }
    // Shades the terrain even at a straight-down view, before tilting makes
    // the 3D displacement itself visible.
    layers.splice(2, 0, {
      id: HILLSHADE_LAYER,
      type: 'hillshade',
      source: TERRAIN_SOURCE,
      paint: { 'hillshade-exaggeration': 0.5 },
    })
  }

  return {
    version: 8,
    // Renders as a sphere at low zoom and flattens to standard mercator as
    // you zoom in — built into MapLibre, no extra layers needed.
    projection: { type: 'globe' },
    sources,
    layers,
    terrain: MAPTILER_KEY ? { source: TERRAIN_SOURCE, exaggeration: 1 } : undefined,
  }
}

const TRAIL_SOURCE = 'trail'
const FENCE_SOURCE = 'fence'
const MISSION_WAYPOINT_MARKERS_SOURCE = 'mission-waypoint-markers'
const MISSION_FLOATING_PATH_SOURCE = 'mission-floating-path'
const MISSION_LOITER_RINGS_SOURCE = 'mission-loiter-rings'
const AIRCRAFT_MARKER_SOURCE = 'aircraft-marker'

const EMPTY_POLYGON: Feature<Polygon> = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } }

function createHomeElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.width = '10px'
  el.style.height = '10px'
  el.style.borderRadius = '2px'
  el.style.border = '2px solid rgba(232, 234, 237, 0.6)'
  return el
}

// Fixed (not the vehicle's live position) so the first leg of the floating
// path is a stable reference line — using live position instead made it
// redraw every tick and look like it was chasing the drone around.
function homeAltitudePoint(vehicleState: VehicleState | null): AltitudePoint | undefined {
  if (!vehicleState?.home) return undefined
  return { point: { lat: vehicleState.home.lat, lon: vehicleState.home.lon }, altM: 0 }
}

function dronePoint(vehicleState: VehicleState | null): GeoPoint | undefined {
  if (!vehicleState) return undefined
  return { lat: vehicleState.position.lat, lon: vehicleState.position.lon }
}

// missionIndex never advances past the last item on completion (there's
// nothing left to advance to), so the index-based clearing alone would leave
// that final leg/marker lingering forever once landed. Past the last item
// *and* landed means the whole mission is done, not just "not started yet"
// (which is also index 0 + landed) — so clear everything in that case by
// reporting an index past the end of the mission.
function pathClearedBeforeIndex(vehicleState: VehicleState | null): number | undefined {
  if (!vehicleState) return undefined
  const { currentIndex, total } = vehicleState.missionProgress
  if (total > 0 && vehicleState.landed && currentIndex >= total - 1) return total
  return currentIndex
}

// While lapping a loiter, the leg into it is dropped outright: trimming it by
// the drone's projection onto the line made it flicker as the drone circled
// the endpoint. The leg out of the loiter is drawn untrimmed for the same
// reason, until the drone actually leaves along it.
function floatingPathGeoJson(mission: Mission | null, vehicleState: VehicleState | null, lapping: boolean) {
  const clearedBeforeIndex = pathClearedBeforeIndex(vehicleState)
  if (lapping && clearedBeforeIndex !== undefined) {
    return buildMissionFloatingPathGeoJson(mission, homeAltitudePoint(vehicleState), clearedBeforeIndex + 1)
  }
  return buildMissionFloatingPathGeoJson(mission, homeAltitudePoint(vehicleState), clearedBeforeIndex, dronePoint(vehicleState))
}

function aircraftPose(vehicleState: VehicleState | null): AircraftPose | null {
  if (!vehicleState) return null
  return {
    point: { lat: vehicleState.position.lat, lon: vehicleState.position.lon },
    altM: vehicleState.position.altRelM,
    headingDeg: vehicleState.attitude.yawDeg,
  }
}

export interface FlightMapProps {
  mission?: Mission | null
  /** Opt-in only — when provided, clicking the map reports the clicked
   * point (e.g. the mission planner adding a waypoint). Not used by the
   * flight screen, so normal flight behavior is unaffected. */
  onMapClick?: (point: GeoPoint) => void
}

export function FlightMap({ mission = null, onMapClick }: FlightMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MaplibreMap | null>(null)
  const homeMarkerRef = useRef<Marker | null>(null)
  const trailRef = useRef<AltitudePoint[]>([])
  const hasCenteredRef = useRef(false)
  const loadedRef = useRef(false)
  const lappingLatchRef = useRef<{ missionId: string; index: number } | null>(null)
  const [basemap, setBasemap] = useState<'street' | 'satellite'>('street')

  const vehicleState = useVehicleStore((s) => s.vehicleState)

  // The mount effect below only runs once; this ref lets it always call the
  // latest onMapClick without re-creating the whole map when it changes.
  const onMapClickRef = useRef(onMapClick)
  useEffect(() => {
    onMapClickRef.current = onMapClick
  }, [onMapClick])

  useEffect(() => {
    if (!containerRef.current) return

    const map = new MaplibreMap({
      container: containerRef.current,
      style: buildMapStyle(),
      center: [0, 0],
      zoom: 2,
      attributionControl: { compact: true },
      // Plain drag pans (dragPan, default on); Ctrl+drag or right-click-drag
      // tilts/rotates away from straight-down (dragRotate + pitchWithRotate,
      // both default on) — the same split Google/Apple Maps use on desktop
      // web, made explicit here rather than relying on defaults.
      dragRotate: true,
      pitchWithRotate: true,
      // MapLibre's own default caps tilt at 60 (30° above horizontal) — not
      // steep enough to read altitude differences on the floating markers/
      // path well. 85 is the library's documented safe practical ceiling
      // (pitch 90 would be perfectly edge-on and prone to z-fighting/clipping).
      maxPitch: 85,
    })
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as { __map?: MaplibreMap }).__map = map

    // The container's final size can settle after this effect runs (e.g. once
    // the HUD strip above it finishes laying out) and MapLibre does not poll
    // for that on its own — without this, the canvas can get stuck at
    // whatever size the container happened to be at construction time.
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(containerRef.current)

    // MapLibre only fires 'click' for an actual tap/click, never for a drag-pan,
    // so this doesn't need to distinguish "clicked" from "just finished panning".
    map.on('click', (e) => {
      onMapClickRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng })
    })

    map.on('load', () => {
      // The drone's actual flown path, floating at its recorded altitude
      // instead of flat on the ground — same fill-extrusion trick as the
      // rest of the overlays (flightMapGeo.ts), solid rather than dashed so
      // it reads as "where it's been" against the dashed "where it's going"
      // planned path.
      map.addSource(TRAIL_SOURCE, { type: 'geojson', data: buildFloatingTrailGeoJson([]) })
      map.addLayer({
        id: TRAIL_SOURCE,
        type: 'fill-extrusion',
        source: TRAIL_SOURCE,
        paint: {
          'fill-extrusion-color': '#00d4ff',
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': 1,
        },
      })

      map.addSource(FENCE_SOURCE, { type: 'geojson', data: buildFenceGeoJson(mission) ?? EMPTY_POLYGON })
      map.addLayer({
        id: FENCE_SOURCE,
        type: 'line',
        source: FENCE_SOURCE,
        paint: { 'line-color': '#fab219', 'line-width': 2 },
      })

      // Small blocks hovering at each waypoint/loiter's altitude — a flat
      // line layer can't show height, so this borrows the same
      // fill-extrusion mechanism used for 3D buildings (flightMapGeo.ts).
      // Disappears once the vehicle has flown through it (missionProgress).
      map.addSource(MISSION_WAYPOINT_MARKERS_SOURCE, {
        type: 'geojson',
        data: buildMissionWaypointMarkersGeoJson(mission, pathClearedBeforeIndex(vehicleState)),
      })
      map.addLayer({
        id: MISSION_WAYPOINT_MARKERS_SOURCE,
        type: 'fill-extrusion',
        source: MISSION_WAYPOINT_MARKERS_SOURCE,
        paint: {
          'fill-extrusion-color': '#9f6fff',
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': 0.85,
        },
      })

      // The planned-path overlay itself, floating at each leg's altitude
      // (sloped between legs of differing altitude) instead of flat on the
      // ground — same fill-extrusion trick, see flightMapGeo.ts. The first
      // leg starts from home (fixed), so the plan shows the transit from
      // launch to the first mission item; legs the vehicle has already
      // cleared are dropped as missionProgress advances.
      map.addSource(MISSION_FLOATING_PATH_SOURCE, {
        type: 'geojson',
        data: floatingPathGeoJson(mission, vehicleState, false),
      })
      map.addLayer({
        id: MISSION_FLOATING_PATH_SOURCE,
        type: 'fill-extrusion',
        source: MISSION_FLOATING_PATH_SOURCE,
        paint: {
          'fill-extrusion-color': '#9f6fff',
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': 0.9,
        },
      })

      // Each loiter item's orbit, traced as a dashed ring at its own
      // altitude — a distinct green (not the path's purple) and near-fully
      // opaque so the lap itself reads clearly apart from the straight
      // transit legs into and out of it. Dropped once flown past, same as
      // the other mission overlays.
      map.addSource(MISSION_LOITER_RINGS_SOURCE, {
        type: 'geojson',
        data: buildMissionLoiterRingsGeoJson(mission, pathClearedBeforeIndex(vehicleState)),
      })
      map.addLayer({
        id: MISSION_LOITER_RINGS_SOURCE,
        type: 'fill-extrusion',
        source: MISSION_LOITER_RINGS_SOURCE,
        paint: {
          'fill-extrusion-color': '#2ecc71',
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': 1,
        },
      })

      // The aircraft indicator itself, floating at its actual altitude and
      // pointed in its actual heading — same fill-extrusion trick, see
      // flightMapGeo.ts. Replaces a plain screen-anchored DOM marker, which
      // had no way to represent altitude at all.
      map.addSource(AIRCRAFT_MARKER_SOURCE, { type: 'geojson', data: buildAircraftMarkerGeoJson(aircraftPose(vehicleState)) })
      map.addLayer({
        id: AIRCRAFT_MARKER_SOURCE,
        type: 'fill-extrusion',
        source: AIRCRAFT_MARKER_SOURCE,
        paint: {
          'fill-extrusion-color': '#00d4ff',
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': 0.95,
        },
      })

      loadedRef.current = true
    })

    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
      homeMarkerRef.current = null
      loadedRef.current = false
      hasCenteredRef.current = false
      trailRef.current = []
    }
    // Mount-once: the map instance must not be torn down and recreated when
    // `mission` changes. The effect below keeps its sources in sync instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    ;(map.getSource(FENCE_SOURCE) as GeoJSONSource | undefined)?.setData(buildFenceGeoJson(mission) ?? EMPTY_POLYGON)
  }, [mission])

  // Separate from the sync above: the floating path and waypoint markers also
  // depend on missionProgress (to drop already-flown legs/waypoints) and home
  // (the path's fixed start point), both carried on vehicleState, so they
  // need to refresh on every telemetry update too, not just mission edits.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    ;(map.getSource(MISSION_WAYPOINT_MARKERS_SOURCE) as GeoJSONSource | undefined)?.setData(
      buildMissionWaypointMarkersGeoJson(mission, pathClearedBeforeIndex(vehicleState)),
    )
    // Latched per loiter: once its laps begin the leg into it stays hidden
    // until the drone moves on, even if wind briefly pushes it off the circle.
    const index = vehicleState?.missionProgress.currentIndex
    const drone = dronePoint(vehicleState)
    const latch = lappingLatchRef.current
    if (latch && (latch.missionId !== mission?.id || latch.index !== index)) lappingLatchRef.current = null
    if (!lappingLatchRef.current && mission && index !== undefined && drone && isLappingCurrentLoiter(mission, index, drone)) {
      lappingLatchRef.current = { missionId: mission.id, index }
    }
    ;(map.getSource(MISSION_FLOATING_PATH_SOURCE) as GeoJSONSource | undefined)?.setData(
      floatingPathGeoJson(mission, vehicleState, lappingLatchRef.current !== null),
    )
    ;(map.getSource(MISSION_LOITER_RINGS_SOURCE) as GeoJSONSource | undefined)?.setData(
      buildMissionLoiterRingsGeoJson(mission, pathClearedBeforeIndex(vehicleState)),
    )
  }, [mission, vehicleState])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !vehicleState) return

    const point: GeoPoint = { lat: vehicleState.position.lat, lon: vehicleState.position.lon }

    if (vehicleState.home && !homeMarkerRef.current) {
      homeMarkerRef.current = new Marker({ element: createHomeElement() })
        .setLngLat([vehicleState.home.lon, vehicleState.home.lat])
        .addTo(map)
    }

    if (!hasCenteredRef.current) {
      map.jumpTo({ center: [point.lon, point.lat], zoom: 16 })
      hasCenteredRef.current = true
    }

    trailRef.current = appendTrailPoint(trailRef.current, { point, altM: vehicleState.position.altRelM })
    if (loadedRef.current) {
      ;(map.getSource(TRAIL_SOURCE) as GeoJSONSource | undefined)?.setData(buildFloatingTrailGeoJson(trailRef.current))
      ;(map.getSource(AIRCRAFT_MARKER_SOURCE) as GeoJSONSource | undefined)?.setData(buildAircraftMarkerGeoJson(aircraftPose(vehicleState)))
    }
  }, [vehicleState])

  function selectBasemap(next: 'street' | 'satellite') {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    map.setLayoutProperty(STREET_LAYER, 'visibility', next === 'street' ? 'visible' : 'none')
    map.setLayoutProperty(SATELLITE_LAYER, 'visibility', next === 'satellite' ? 'visible' : 'none')
    setBasemap(next)
  }

  /** First click squares the camera up (north-up, straight down); once
   * already square, the next click centers on the drone instead — checked
   * against the map's actual current orientation, not a separate counter, so
   * it stays correct even if the user re-tilts by hand in between clicks. */
  function handleRecenter() {
    const map = mapRef.current
    if (!map) return

    const isSquare = Math.abs(map.getBearing()) < 0.5 && Math.abs(map.getPitch()) < 0.5
    if (!isSquare) {
      map.easeTo({ pitch: 0, bearing: 0, duration: 400 })
    } else if (vehicleState) {
      map.easeTo({ center: [vehicleState.position.lon, vehicleState.position.lat], duration: 400 })
    }
  }

  return (
    <div className="absolute inset-0 flex">
      {/* Fills whatever box it's given — the parent just needs to be `relative`
          with a definite size. `absolute inset-0` composes with any parent
          layout (flex-grow, fixed pixels, ...) without re-triggering the
          percentage-height bug that bit the first version of this component. */}
      <div ref={containerRef} className="w-full flex-1" />

      <div className="glass-panel absolute right-4 top-14 z-10 flex overflow-hidden p-0.5">
        <button
          type="button"
          onClick={() => selectBasemap('street')}
          aria-pressed={basemap === 'street'}
          className="hud-label rounded-md px-2.5 py-1 transition"
          style={basemap === 'street' ? { color: 'var(--primary)', background: 'var(--accent)' } : undefined}
        >
          Street
        </button>
        <button
          type="button"
          onClick={() => selectBasemap('satellite')}
          aria-pressed={basemap === 'satellite'}
          className="hud-label rounded-md px-2.5 py-1 transition"
          style={basemap === 'satellite' ? { color: 'var(--primary)', background: 'var(--accent)' } : undefined}
        >
          Satellite
        </button>
      </div>

      <button
        type="button"
        onClick={handleRecenter}
        aria-label="Square up the camera, then center on the drone"
        className="glass-panel absolute right-4 top-24 z-10 flex h-8 w-8 items-center justify-center transition hover:ring-2 hover:ring-primary"
      >
        <LocateFixed size={14} style={{ color: 'var(--primary)' }} aria-hidden />
      </button>
    </div>
  )
}
