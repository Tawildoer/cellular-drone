import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, XCircle } from 'lucide-react'
import { useTerrainService, useVehicleStore } from '../../app/store-hooks'
import { Button } from '../../components/ui/button'
import {
  buildMissionProfile,
  SITL_PERFORMANCE,
  TERRAIN_CLEARANCE_WARN_M,
  type GeoPoint,
  type LowestClearance,
  type Mission,
  type MissionItem,
} from '../../domain'
import { MissionProfileChart, MissionProfileLegend } from './MissionProfileChart'
import { followTerrain } from './followTerrain'
import { formatDistance, formatDuration } from './profileFormat'
import { useTerrainClearance, type TerrainState } from './useTerrainClearance'

/**
 * The plan side-on (height above home over the ground under it) and what
 * flying it takes: distance and time at ArduPlane's figures (SITL until the
 * airframe is tuned). Mission heights are above home, not above the ground
 * (docs/MAVLINK.md), so a leg that's fine at home can meet a hill: this is
 * where the planner sees that.
 */
export function MissionProfilePanel({
  mission,
  onChangeItems,
}: {
  mission: Mission
  onChangeItems: (items: MissionItem[]) => void
}) {
  const [open, setOpen] = useState(false)
  // By value: telemetry hands over a new home object on every update.
  const homeLat = useVehicleStore((s) => s.vehicleState?.home?.lat)
  const homeLon = useVehicleStore((s) => s.vehicleState?.home?.lon)
  const home = useMemo<GeoPoint | null>(
    () => (homeLat === undefined || homeLon === undefined ? null : { lat: homeLat, lon: homeLon }),
    [homeLat, homeLon],
  )
  const profile = useMemo(() => (home ? buildMissionProfile(mission, home) : null), [mission, home])
  const terrain = useTerrainClearance(profile, home)

  if (!profile) {
    return (
      <div className="glass-panel w-[30rem] px-2.5 py-1.5">
        <span className="hud-label">Profile · waiting for the vehicle&apos;s home position</span>
      </div>
    )
  }

  const clearance = terrain.status === 'ready' ? terrain.clearance : null

  return (
    // Capped and scrolling inside: the planner's panels stack up from the
    // bottom, so a taller panel would push its own header off the screen.
    <div className="glass-panel flex max-h-[40vh] w-[30rem] flex-col overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-left"
      >
        {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
        <span className="hud-label flex-1 whitespace-nowrap">
          Profile · {formatDistance(profile.flownDistanceM)} · {profile.durationIsMinimum ? '≥ ' : '~'}
          {formatDuration(profile.durationS)}
        </span>
        <ClearanceBadge terrain={terrain} />
      </button>

      {open && (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto border-t border-border/60 px-2.5 py-1.5">
          {profile.routeDistanceM < 1 ? (
            <p className="text-xs opacity-70">Add waypoints to see the route side-on: click the map while planning.</p>
          ) : (
            <>
              <MissionProfileLegend hasGround={clearance !== null} />
              <MissionProfileChart profile={profile} clearance={clearance} />
            </>
          )}
          {terrain.status !== 'unavailable' && home && (
            <FollowTerrainControl mission={mission} home={home} onChangeItems={onChangeItems} />
          )}
          {clearance && <ClearanceNotes lowest={clearance.lowest} incomplete={clearance.incomplete} loiters={clearance.loiters} />}
          <p className="text-xs opacity-60">
            Estimates at ArduPlane SITL figures: {SITL_PERFORMANCE.cruiseMps} m/s cruise, VTOL climb{' '}
            {SITL_PERFORMANCE.vtolClimbMps} m/s, RTL home at {SITL_PERFORMANCE.rtlAltM} m. {terrainFootnote(terrain)}
          </p>
        </div>
      )}
    </div>
  )
}

function terrainFootnote(terrain: TerrainState): string {
  switch (terrain.status) {
    case 'ready':
      return `Ground: ${terrain.description}. No trees, buildings or masts, so keep a margin.`
    case 'unavailable':
      return 'No terrain source configured (it needs VITE_MAPTILER_KEY), so the ground isn’t shown.'
    case 'failed':
      return 'Terrain data couldn’t be loaded.'
    case 'loading':
      return 'Loading terrain…'
    case 'noRoute':
      return ''
  }
}

function ClearanceBadge({ terrain }: { terrain: TerrainState }) {
  if (terrain.status === 'loading') {
    return <Loader2 size={12} className="animate-spin opacity-60" aria-label="Loading terrain" />
  }
  if (terrain.status !== 'ready' || !terrain.clearance.lowest) return null
  const { clearanceM } = terrain.clearance.lowest
  const status = clearanceM < 0 ? 'critical' : clearanceM < TERRAIN_CLEARANCE_WARN_M ? 'warning' : 'good'
  const Icon = status === 'critical' ? XCircle : status === 'warning' ? AlertTriangle : CheckCircle2
  return (
    <span className="hud-label flex items-center gap-1 whitespace-nowrap" style={{ color: `var(--status-${status})` }}>
      <Icon size={12} aria-hidden />
      {clearanceM < 0 ? `${Math.round(-clearanceM)} m below ground` : `${Math.round(clearanceM)} m min clearance`}
    </span>
  )
}

function ClearanceNotes({
  lowest,
  incomplete,
  loiters,
}: {
  lowest: LowestClearance | null
  incomplete: boolean
  loiters: { itemIndex: number; clearanceM: number | null }[]
}) {
  const notes: { text: string; critical: boolean }[] = []
  if (lowest && lowest.clearanceM < TERRAIN_CLEARANCE_WARN_M) {
    const where = lowest.onLoiter
      ? `around item ${(lowest.itemIndex ?? 0) + 1}'s loiter circle`
      : lowest.itemIndex === null
        ? 'on the first leg'
        : `after item ${lowest.itemIndex + 1}`
    notes.push({
      text:
        lowest.clearanceM < 0
          ? `The plan goes ${Math.round(-lowest.clearanceM)} m below the ground ${where}, ${formatDistance(lowest.distanceM)} along. Raise it.`
          : `Only ${Math.round(lowest.clearanceM)} m above the ground ${where}, ${formatDistance(lowest.distanceM)} along (under ${TERRAIN_CLEARANCE_WARN_M} m).`,
      critical: lowest.clearanceM < 0,
    })
  }
  for (const loiter of loiters) {
    if (loiter.clearanceM !== null && loiter.clearanceM < TERRAIN_CLEARANCE_WARN_M && !(lowest?.onLoiter && lowest.itemIndex === loiter.itemIndex)) {
      notes.push({
        text: `Item ${loiter.itemIndex + 1}'s loiter circle passes ${Math.round(loiter.clearanceM)} m over its highest ground.`,
        critical: loiter.clearanceM < 0,
      })
    }
  }
  if (incomplete) notes.push({ text: 'Some of the route has no terrain data.', critical: false })
  if (notes.length === 0) return null
  return (
    <ul className="flex flex-col gap-1">
      {notes.map((note, i) => {
        const Icon = note.critical ? XCircle : AlertTriangle
        const color = note.critical ? 'var(--status-critical)' : 'var(--status-warning)'
        return (
          <li key={i} className="flex gap-1.5 text-xs" style={{ color }}>
            <Icon size={12} className="mt-0.5 shrink-0" aria-hidden />
            <span>{note.text}</span>
          </li>
        )
      })}
    </ul>
  )
}

const DEFAULT_ABOVE_GROUND_M = 60

/**
 * "Fly X m above the ground", done here in the planner (ADR-0021): sets the
 * heights from the terrain and adds waypoints over ridges. Undo puts the
 * items back as they were before the last apply.
 */
function FollowTerrainControl({
  mission,
  home,
  onChangeItems,
}: {
  mission: Mission
  home: GeoPoint
  onChangeItems: (items: MissionItem[]) => void
}) {
  const terrain = useTerrainService()
  const [aboveGroundM, setAboveGroundM] = useState(DEFAULT_ABOVE_GROUND_M)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; warning: boolean } | null>(null)
  // Undo only while the plan is still exactly what Apply made: after any
  // other edit it would throw that edit away.
  const [applied, setApplied] = useState<{ before: MissionItem[]; after: MissionItem[] } | null>(null)
  const canUndo = applied !== null && applied.after === mission.items

  async function apply() {
    if (!terrain) return
    setBusy(true)
    try {
      const result = await followTerrain(terrain, mission, home, aboveGroundM)
      setApplied({ before: mission.items, after: result.items })
      onChangeItems(result.items)
      const parts = [`Set ${result.heightsChanged} height${result.heightsChanged === 1 ? '' : 's'}`]
      if (result.waypointsAdded > 0) parts.push(`added ${result.waypointsAdded} waypoint${result.waypointsAdded === 1 ? '' : 's'} over high ground`)
      const warnings: string[] = []
      if (result.capped) warnings.push(`Stopped after adding ${result.waypointsAdded}: some legs are still low.`)
      if (result.rtlClearanceM !== null && result.rtlClearanceM < aboveGroundM - 3) {
        warnings.push(
          `The flight home flies at the flight controller's RTL_ALTITUDE (${SITL_PERFORMANCE.rtlAltM} m), only ${Math.round(result.rtlClearanceM)} m over the ground at its lowest: the planner can't raise it.`,
        )
      }
      setMessage({ text: `${parts.join(', ')}.${warnings.length ? ` ${warnings.join(' ')}` : ''}`, warning: warnings.length > 0 })
    } catch {
      setMessage({ text: 'Terrain data couldn’t be loaded, so nothing changed.', warning: true })
    } finally {
      setBusy(false)
    }
  }

  function undo() {
    if (!canUndo) return
    onChangeItems(applied.before)
    setApplied(null)
    setMessage(null)
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <label className="hud-label flex items-center gap-1.5">
          Follow terrain at
          <input
            type="number"
            min={10}
            max={120}
            step={5}
            value={aboveGroundM}
            onChange={(e) => setAboveGroundM(Number(e.target.value))}
            className="w-14 rounded border border-border/60 bg-transparent px-1 py-0.5 text-right text-xs"
            aria-label="Height above the ground, metres"
          />
          m
        </label>
        <Button type="button" size="sm" variant="secondary" disabled={busy || !(aboveGroundM > 0)} onClick={() => void apply()}>
          {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}
          Apply
        </Button>
        {canUndo && (
          <Button type="button" size="sm" variant="ghost" onClick={undo}>
            Undo
          </Button>
        )}
      </div>
      {message && (
        <p className="text-xs" style={message.warning ? { color: 'var(--status-warning)' } : { opacity: 0.8 }}>
          {message.text}
        </p>
      )}
    </div>
  )
}

