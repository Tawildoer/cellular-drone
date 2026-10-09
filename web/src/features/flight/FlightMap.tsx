import {
  Map as MaplibreMap,
  Marker,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type StyleSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { Feature, Polygon } from 'geojson'
import { LocateFixed } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useVehicleStore } from '../../app/store-hooks'
import { useTelemetryStale } from './telemetryAge'
import type { GeoPoint, Mission, VehicleState } from '../../domain'
import {
  aircraftMarkerScale,
  appendTrailPoint,
  MAX_TRAIL_POINTS,
  buildAircraftMarkerGeoJson,
  buildFenceGeoJson,
  buildFloatingTrailGeoJson,
  buildMissionFloatingPathGeoJson,
  buildMissionLoiterRingLinesGeoJson,
  buildMissionLoiterRingsGeoJson,
  buildMissionPathLinesGeoJson,
  buildMissionWaypointMarkersGeoJson,
  buildMissionWaypointPointsGeoJson,
  buildTrailLineGeoJson,
  isLappingCurrentLoiter,
  metersPerPixel,
  missionBounds,
  MISSION_FIT_MAX_ZOOM,
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

// MapLibre parses every GeoJSON and vector-tile source (the aircraft, trail,
// mission overlays, 3D buildings) in a web worker it finds at
// ./maplibre-gl-worker.mjs next to its own module. Once bundled, "next to its
// own module" is /assets/, where nothing is emitted — so in production the
// worker silently failed and only raster tiles drew. `?worker&url` has Vite
// bundle the worker (with the shared chunk it imports) and hand back its URL.
setWorkerUrl(maplibreWorkerUrl)

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
      // Not below FLAT_OVERLAY_MAX_ZOOM: with terrain on, the flat zoomed-out
      // overlays are draped onto the ground, where building roofs cover them.
      // Switched by camera zoom (syncZoomLayers), not a layer minzoom.
      layout: { visibility: 'none' },
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
/** Planned waypoints in the route's violet; flown-through ones green, as done. */
const WAYPOINT_COLOR: ExpressionSpecification = ['case', ['boolean', ['get', 'done'], false], '#2ecc71', '#9f6fff']
const MISSION_FLOATING_PATH_SOURCE = 'mission-floating-path'
const MISSION_LOITER_RINGS_SOURCE = 'mission-loiter-rings'
const AIRCRAFT_MARKER_SOURCE = 'aircraft-marker'
const TRAIL_FLAT_SOURCE = 'trail-flat'
const MISSION_PATH_FLAT_SOURCE = 'mission-path-flat'
const MISSION_LOITER_RINGS_FLAT_SOURCE = 'mission-loiter-rings-flat'
const MISSION_WAYPOINTS_FLAT_SOURCE = 'mission-waypoints-flat'

/** Below this zoom the trail, path, loiter rings and waypoints draw as flat
 * line/circle layers instead of floating 3D extrusions. From far away the
 * extrusions — all in the drone's own ~1m altitude band — z-fight through
 * each other (flightMapGeo.ts, "Flat (zoomed-out) overlays"). The aircraft
 * swaps too, to an HTML marker: alone out there, the 3D arrow still clipped
 * into the terrain. 14 rather than 15: switching at 15 came too close in and
 * felt jarring (2026-10-07). If the extrusions start flickering just above
 * 14, that's the z-fighting this guards against: nudge it back up. */
const FLAT_OVERLAY_MAX_ZOOM = 14

/**
 * The 3D layers shown from FLAT_OVERLAY_MAX_ZOOM in, switched by the
 * *camera's* zoom in syncZoomLayers rather than a layer `minzoom`. MapLibre
 * applies a layer minzoom to each tile's own zoom, and a tilted camera loads
 * distant tiles at lower zooms, so with a minzoom the far part of the path,
 * the trail, the aircraft and the buildings vanished at a shallow angle
 * while the flat stand-ins were still switched off by the camera zoom.
 */
const LAYERS_3D = [
  TRAIL_SOURCE,
  MISSION_WAYPOINT_MARKERS_SOURCE,
  MISSION_FLOATING_PATH_SOURCE,
  MISSION_LOITER_RINGS_SOURCE,
  AIRCRAFT_MARKER_SOURCE,
  BUILDINGS_LAYER,
]

/** Their flat stand-ins, shown exactly when LAYERS_3D aren't. Same reason
 * for not using a layer `maxzoom`: a tilted camera loads the tiles nearest it
 * at a higher zoom than its own, so just below the threshold the flat path
 * went missing there while the 3D one was already switched off. */
const LAYERS_FLAT = [TRAIL_FLAT_SOURCE, MISSION_PATH_FLAT_SOURCE, MISSION_LOITER_RINGS_FLAT_SOURCE, MISSION_WAYPOINTS_FLAT_SOURCE]

function setVisible(map: MaplibreMap, ids: string[], visible: boolean) {
  const visibility = visible ? 'visible' : 'none'
  for (const id of ids) {
    if (map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== visibility) {
      map.setLayoutProperty(id, 'visibility', visibility)
    }
  }
}

/** Switches between the 3D and flat overlay sets by the camera's zoom. */
function syncZoomLayers(map: MaplibreMap) {
  const zoomedIn = map.getZoom() >= FLAT_OVERLAY_MAX_ZOOM
  setVisible(map, LAYERS_3D, zoomedIn)
  setVisible(map, LAYERS_FLAT, !zoomedIn)
}

/** For the 3D overlay sources: no simplification, so a distant low-zoom
 * tile keeps the small aircraft shape and thin ribbons intact. */
const OVERLAY_3D_SOURCE = { tolerance: 0 } as const

/**
 * Tile level of detail for the buildings when the camera is tilted. The
 * vector tiles only carry buildings from about z13, so MapLibre's default
 * (dropping zoom quickly toward the horizon) loses them in the middle
 * distance. Fewer zoom levels on screen keeps them further out, at the cost
 * of loading more tiles. Tune here if it gets slow.
 */
const BUILDINGS_TILE_LOD = { maxZoomLevelsOnScreen: 3, tileCountMaxMinRatio: 5 } as const

function setSourceData(map: MaplibreMap, id: string, data: Parameters<GeoJSONSource['setData']>[0]) {
  ;(map.getSource(id) as GeoJSONSource | undefined)?.setData(data)
}

const EMPTY_POLYGON: Feature<Polygon> = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } }

// The zoomed-out aircraft (see FLAT_OVERLAY_MAX_ZOOM): an HTML marker drawn
// over the map canvas, so it can't clip into the terrain the way the 3D arrow
// did from far away. Same triangle as buildAircraftMarkerGeoJson, nose up at
// 0°, centred on the vehicle's position so rotation pivots about it.
function createAircraftElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.innerHTML =
    '<svg width="28" height="28" viewBox="-5 -5 10 10" aria-hidden="true">' +
    '<path d="M0 -5 L3 3 L-3 3 Z" fill="#00d4ff" stroke="rgba(0,0,0,0.45)" stroke-width="0.4" stroke-linejoin="round"/>' +
    '</svg>'
  return el
}

// Shown only below FLAT_OVERLAY_MAX_ZOOM; the 3D arrow takes over from there.
function syncFlatAircraftVisibility(map: MaplibreMap, marker: Marker) {
  marker.getElement().style.display = map.getZoom() < FLAT_OVERLAY_MAX_ZOOM ? '' : 'none'
}

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
function floatingPathGeoJson(mission: Mission | null, vehicleState: VehicleState | null, lapping: boolean, metersPerPx: number) {
  const clearedBeforeIndex = pathClearedBeforeIndex(vehicleState)
  const home = homeAltitudePoint(vehicleState)
  if (lapping && clearedBeforeIndex !== undefined) {
    return buildMissionFloatingPathGeoJson(mission, home, clearedBeforeIndex + 1, undefined, metersPerPx)
  }
  return buildMissionFloatingPathGeoJson(mission, home, clearedBeforeIndex, dronePoint(vehicleState), metersPerPx)
}

// The flat counterpart, with the same lapping rule.
function flatPathGeoJson(mission: Mission | null, vehicleState: VehicleState | null, lapping: boolean) {
  const clearedBeforeIndex = pathClearedBeforeIndex(vehicleState)
  const home = homeAltitudePoint(vehicleState)
  if (lapping && clearedBeforeIndex !== undefined) {
    return buildMissionPathLinesGeoJson(mission, home, clearedBeforeIndex + 1)
  }
  return buildMissionPathLinesGeoJson(mission, home, clearedBeforeIndex, dronePoint(vehicleState))
}

// The overlays are built in metres; this lets them keep a minimum on-screen
// size however far out the map is zoomed (flightMapGeo.ts, atLeastPx).
function viewMetersPerPx(map: MaplibreMap): number {
  return metersPerPixel(map.getZoom(), map.getCenter().lat)
}

function aircraftPose(vehicleState: VehicleState | null): AircraftPose | null {
  if (!vehicleState) return null
  return {
    point: { lat: vehicleState.position.lat, lon: vehicleState.position.lon },
    altM: vehicleState.position.altRelM,
    headingDeg: vehicleState.attitude.yawDeg,
  }
}

// Sized for the map's current zoom, so the aircraft stays a legible size on
// screen instead of shrinking to a few pixels when zoomed out.
function aircraftGeoJson(map: MaplibreMap, vehicleState: VehicleState | null) {
  const pose = aircraftPose(vehicleState)
  return buildAircraftMarkerGeoJson(pose, pose ? aircraftMarkerScale(map.getZoom(), pose.point.lat) : 1)
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
  const aircraftMarkerRef = useRef<Marker | null>(null)
  const trailRef = useRef<AltitudePoint[]>([])
  const hasCenteredRef = useRef(false)
  const loadedRef = useRef(false)
  const lappingLatchRef = useRef<{ missionId: string; index: number } | null>(null)
  const [basemap, setBasemap] = useState<'street' | 'satellite'>('street')

  const vehicleState = useVehicleStore((s) => s.vehicleState)
  const telemetryStale = useTelemetryStale()
  // For map event handlers registered once at mount (the zoom resize below).
  const vehicleStateRef = useRef(vehicleState)
  useEffect(() => {
    vehicleStateRef.current = vehicleState
  }, [vehicleState])
  const missionRef = useRef(mission)
  useEffect(() => {
    missionRef.current = mission
  }, [mission])
  // Scale the overlays were last rebuilt at during a zoom gesture.
  const lastZoomMetersPerPxRef = useRef(Infinity)

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
      map.addSource(TRAIL_SOURCE, { type: 'geojson', ...OVERLAY_3D_SOURCE, data: buildFloatingTrailGeoJson([]) })
      map.addLayer({
        id: TRAIL_SOURCE,
        type: 'fill-extrusion',
        source: TRAIL_SOURCE,
        layout: { visibility: 'none' }, // by camera zoom: syncZoomLayers
        paint: {
          // Expiring segments darken towards the map (buildFloatingTrailGeoJson).
          'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'fade'], 0, '#0b2a33', 0.6, '#0a8fb0', 1, '#00d4ff'],
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
      // Turns green once the vehicle has flown through it (missionProgress).
      map.addSource(MISSION_WAYPOINT_MARKERS_SOURCE, {
        type: 'geojson',
        ...OVERLAY_3D_SOURCE,
        data: buildMissionWaypointMarkersGeoJson(mission, pathClearedBeforeIndex(vehicleState), viewMetersPerPx(map)),
      })
      map.addLayer({
        id: MISSION_WAYPOINT_MARKERS_SOURCE,
        type: 'fill-extrusion',
        source: MISSION_WAYPOINT_MARKERS_SOURCE,
        layout: { visibility: 'none' }, // by camera zoom: syncZoomLayers
        paint: {
          'fill-extrusion-color': WAYPOINT_COLOR,
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
        ...OVERLAY_3D_SOURCE,
        data: floatingPathGeoJson(mission, vehicleState, false, viewMetersPerPx(map)),
      })
      map.addLayer({
        id: MISSION_FLOATING_PATH_SOURCE,
        type: 'fill-extrusion',
        source: MISSION_FLOATING_PATH_SOURCE,
        layout: { visibility: 'none' }, // by camera zoom: syncZoomLayers
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
        ...OVERLAY_3D_SOURCE,
        data: buildMissionLoiterRingsGeoJson(mission, pathClearedBeforeIndex(vehicleState), viewMetersPerPx(map)),
      })
      map.addLayer({
        id: MISSION_LOITER_RINGS_SOURCE,
        type: 'fill-extrusion',
        source: MISSION_LOITER_RINGS_SOURCE,
        layout: { visibility: 'none' }, // by camera zoom: syncZoomLayers
        paint: {
          'fill-extrusion-color': '#2ecc71',
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': 1,
        },
      })

      // Zoomed-out stand-ins for the four extrusion layers above (see
      // FLAT_OVERLAY_MAX_ZOOM): fixed pixel widths, drawn in this order with no
      // depth, so nothing can fight. Same colours and dashing as the 3D set.
      // Shown below FLAT_OVERLAY_MAX_ZOOM by syncZoomLayers, not a maxzoom.
      // Expiring pieces of trail fade out by age (buildTrailLineGeoJson).
      // Butt caps: round ones would overlap, and show as dots, where
      // half-transparent segments meet.
      map.addSource(TRAIL_FLAT_SOURCE, { type: 'geojson', data: buildTrailLineGeoJson(trailRef.current, Date.now()) })
      map.addLayer({
        id: TRAIL_FLAT_SOURCE,
        type: 'line',
        source: TRAIL_FLAT_SOURCE,
        layout: { 'line-join': 'round', 'line-cap': 'butt' },
        paint: { 'line-color': '#00d4ff', 'line-width': 2.5, 'line-opacity': ['get', 'fade'] },
      })
      map.addSource(MISSION_PATH_FLAT_SOURCE, { type: 'geojson', data: flatPathGeoJson(mission, vehicleState, false) })
      map.addLayer({
        id: MISSION_PATH_FLAT_SOURCE,
        type: 'line',
        source: MISSION_PATH_FLAT_SOURCE,
        paint: { 'line-color': '#9f6fff', 'line-width': 2, 'line-dasharray': [2, 1.5] },
      })
      map.addSource(MISSION_LOITER_RINGS_FLAT_SOURCE, {
        type: 'geojson',
        data: buildMissionLoiterRingLinesGeoJson(mission, pathClearedBeforeIndex(vehicleState)),
      })
      map.addLayer({
        id: MISSION_LOITER_RINGS_FLAT_SOURCE,
        type: 'line',
        source: MISSION_LOITER_RINGS_FLAT_SOURCE,
        paint: { 'line-color': '#2ecc71', 'line-width': 2, 'line-dasharray': [2, 1.5] },
      })
      map.addSource(MISSION_WAYPOINTS_FLAT_SOURCE, {
        type: 'geojson',
        data: buildMissionWaypointPointsGeoJson(mission, pathClearedBeforeIndex(vehicleState)),
      })
      map.addLayer({
        id: MISSION_WAYPOINTS_FLAT_SOURCE,
        type: 'circle',
        source: MISSION_WAYPOINTS_FLAT_SOURCE,
        paint: { 'circle-radius': 4, 'circle-color': WAYPOINT_COLOR },
      })

      // The aircraft indicator itself, floating at its actual altitude and
      // pointed in its actual heading — same fill-extrusion trick, see
      // flightMapGeo.ts. From FLAT_OVERLAY_MAX_ZOOM in only; further out an
      // HTML marker (createAircraftElement) stands in.
      map.addSource(AIRCRAFT_MARKER_SOURCE, { type: 'geojson', ...OVERLAY_3D_SOURCE, data: aircraftGeoJson(map, vehicleStateRef.current) })
      map.addLayer({
        id: AIRCRAFT_MARKER_SOURCE,
        type: 'fill-extrusion',
        source: AIRCRAFT_MARKER_SOURCE,
        layout: { visibility: 'none' }, // by camera zoom: syncZoomLayers
        paint: {
          'fill-extrusion-color': '#00d4ff',
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': 0.95,
        },
      })

      syncZoomLayers(map)
      if (map.getSource(BUILDINGS_SOURCE)) {
        map.setSourceTileLodParams(BUILDINGS_TILE_LOD.maxZoomLevelsOnScreen, BUILDINGS_TILE_LOD.tileCountMaxMinRatio, BUILDINGS_SOURCE)
      }
      loadedRef.current = true
    })

    // Keep the 3D overlays' on-screen size steady through a zoom gesture
    // rather than waiting for the next telemetry tick (or forever, if
    // telemetry has stopped) to resize them. Skipped until the scale has moved
    // ~5%: rebuilding the dashed overlays on every animation frame changes
    // nothing visible. The flat layers are drawn in pixels already.
    map.on('zoom', () => {
      if (aircraftMarkerRef.current) syncFlatAircraftVisibility(map, aircraftMarkerRef.current)
      if (!loadedRef.current) return
      syncZoomLayers(map)
      const metersPerPx = viewMetersPerPx(map)
      if (Math.abs(metersPerPx / lastZoomMetersPerPxRef.current - 1) < 0.05) return
      lastZoomMetersPerPxRef.current = metersPerPx

      const mission = missionRef.current
      const vehicleState = vehicleStateRef.current
      setSourceData(map, MISSION_WAYPOINT_MARKERS_SOURCE, buildMissionWaypointMarkersGeoJson(mission, pathClearedBeforeIndex(vehicleState), metersPerPx))
      setSourceData(map, MISSION_FLOATING_PATH_SOURCE, floatingPathGeoJson(mission, vehicleState, lappingLatchRef.current !== null, metersPerPx))
      setSourceData(map, MISSION_LOITER_RINGS_SOURCE, buildMissionLoiterRingsGeoJson(mission, pathClearedBeforeIndex(vehicleState), metersPerPx))
      setSourceData(map, TRAIL_SOURCE, buildFloatingTrailGeoJson(trailRef.current, metersPerPx, Date.now()))
      setSourceData(map, AIRCRAFT_MARKER_SOURCE, aircraftGeoJson(map, vehicleState))
    })

    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
      homeMarkerRef.current = null
      aircraftMarkerRef.current = null
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
    const metersPerPx = viewMetersPerPx(map)
    ;(map.getSource(MISSION_WAYPOINT_MARKERS_SOURCE) as GeoJSONSource | undefined)?.setData(
      buildMissionWaypointMarkersGeoJson(mission, pathClearedBeforeIndex(vehicleState), metersPerPx),
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
      floatingPathGeoJson(mission, vehicleState, lappingLatchRef.current !== null, metersPerPx),
    )
    ;(map.getSource(MISSION_LOITER_RINGS_SOURCE) as GeoJSONSource | undefined)?.setData(
      buildMissionLoiterRingsGeoJson(mission, pathClearedBeforeIndex(vehicleState), metersPerPx),
    )
    setSourceData(map, MISSION_PATH_FLAT_SOURCE, flatPathGeoJson(mission, vehicleState, lappingLatchRef.current !== null))
    setSourceData(map, MISSION_LOITER_RINGS_FLAT_SOURCE, buildMissionLoiterRingLinesGeoJson(mission, pathClearedBeforeIndex(vehicleState)))
    setSourceData(map, MISSION_WAYPOINTS_FLAT_SOURCE, buildMissionWaypointPointsGeoJson(mission, pathClearedBeforeIndex(vehicleState)))
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

    // No fix, no position: a flight controller that hasn't got one yet
    // reports 0°, 0°, and drawing it would centre the map off Africa and
    // trail a line from there once the real position arrives.
    if (vehicleState.gps.fixType === 'none') return

    if (!hasCenteredRef.current) {
      map.jumpTo({ center: [point.lon, point.lat], zoom: 16 })
      hasCenteredRef.current = true
    }

    // 'map' alignment: rotation is a compass heading, and when tilted it lies
    // flat on the map like the flat overlays rather than facing the camera.
    aircraftMarkerRef.current ??= new Marker({ element: createAircraftElement(), rotationAlignment: 'map', pitchAlignment: 'map' })
      .setLngLat([point.lon, point.lat])
      .addTo(map)
    aircraftMarkerRef.current.setLngLat([point.lon, point.lat]).setRotation(vehicleState.attitude.yawDeg)
    syncFlatAircraftVisibility(map, aircraftMarkerRef.current)

    const now = Date.now()
    trailRef.current = appendTrailPoint(trailRef.current, { point, altM: vehicleState.position.altRelM, atMs: now }, MAX_TRAIL_POINTS, now)
    if (loadedRef.current) {
      ;(map.getSource(TRAIL_SOURCE) as GeoJSONSource | undefined)?.setData(
        buildFloatingTrailGeoJson(trailRef.current, viewMetersPerPx(map), now),
      )
      setSourceData(map, TRAIL_FLAT_SOURCE, buildTrailLineGeoJson(trailRef.current, now))
      ;(map.getSource(AIRCRAFT_MARKER_SOURCE) as GeoJSONSource | undefined)?.setData(aircraftGeoJson(map, vehicleState))
    }
  }, [vehicleState])

  // Stale telemetry: the aircraft is drawn faded, so its position reads as
  // "last known", not "here now" (StatusBanners says so in words).
  useEffect(() => {
    const opacity = telemetryStale ? 0.35 : 1
    const marker = aircraftMarkerRef.current
    if (marker) marker.getElement().style.opacity = String(opacity)
    const map = mapRef.current
    if (map && loadedRef.current && map.getLayer(AIRCRAFT_MARKER_SOURCE)) {
      map.setPaintProperty(AIRCRAFT_MARKER_SOURCE, 'fill-extrusion-opacity', 0.95 * opacity)
    }
  }, [telemetryStale])

  function selectBasemap(next: 'street' | 'satellite') {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    map.setLayoutProperty(STREET_LAYER, 'visibility', next === 'street' ? 'visible' : 'none')
    map.setLayoutProperty(SATELLITE_LAYER, 'visibility', next === 'satellite' ? 'visible' : 'none')
    setBasemap(next)
  }

  /** First click squares the camera up (north-up, straight down); once
   * already square, the next click fits the whole mission in view: every
   * item, loiter circles, home and the drone (missionBounds). Checked
   * against the map's actual current orientation, not a separate counter, so
   * it stays correct even if the user re-tilts by hand in between clicks. */
  function handleRecenter() {
    const map = mapRef.current
    if (!map) return

    const isSquare = Math.abs(map.getBearing()) < 0.5 && Math.abs(map.getPitch()) < 0.5
    if (!isSquare) {
      map.easeTo({ pitch: 0, bearing: 0, duration: 400 })
      return
    }
    const drone = vehicleState ? { lat: vehicleState.position.lat, lon: vehicleState.position.lon } : null
    const bounds = missionBounds(mission, vehicleState?.home ?? null, drone)
    if (!bounds) return
    // Keep the route clear of the overlay panels: the HUD across the top,
    // the progress and mission panels down the left, the command bar along
    // the bottom. Scaled to the map's size so a small window still fits.
    const { clientWidth: w, clientHeight: h } = map.getContainer()
    const padding = {
      top: Math.min(140, h * 0.2),
      bottom: Math.min(140, h * 0.2),
      left: Math.min(330, w * 0.3),
      right: Math.min(80, w * 0.08),
    }
    map.fitBounds(bounds, { padding, maxZoom: MISSION_FIT_MAX_ZOOM, duration: 600 })
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
        aria-label="Square up the camera, then fit the whole mission in view"
        className="glass-panel absolute right-4 top-24 z-10 flex h-8 w-8 items-center justify-center transition hover:ring-2 hover:ring-primary"
      >
        <LocateFixed size={14} style={{ color: 'var(--primary)' }} aria-hidden />
      </button>
    </div>
  )
}
