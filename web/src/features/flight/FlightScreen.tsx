import { useCallback, useMemo, useState } from 'react'
import { useMissionStore, useVehicleStore } from '../../app/store-hooks'
import { CommandBar } from '../command-bar/CommandBar'
import { PreflightChecklist } from '../checklist/PreflightChecklist'
import { itemPosition, type GeoPoint } from '../../domain'
import { MissionItemListPanel } from '../mission-planner/MissionItemListPanel'
import { MissionListPanel } from '../mission-planner/MissionListPanel'
import { MissionProfilePanel } from '../mission-planner/MissionProfilePanel'
import { MissionValidationPanel } from '../mission-planner/MissionValidationPanel'
import { insertWaypoint, skeletonItems } from '../mission-planner/missionEdit'
import { FlightPiP } from './FlightPiP'
import { HudStrip } from './HudStrip'
import { MissionProgressPanel } from './MissionProgressPanel'
import { MenuDrawer } from './MenuDrawer'
import { RcOverrideBanner } from './RcOverrideBanner'
import { FailsafeBanners, TelemetryStaleBanner } from './StatusBanners'
import { useFlightMission } from './useFlightMission'
import { useFlightRecorder } from './useFlightRecorder'
import { useGimbalLock } from './useGimbalLock'
import { FreeFlyBanner, FreeFlyButton, useFreeFly, WaypointMenu, type WaypointMenuAnchor } from './FreeFly'
import { BatteryReturnWarning } from './BatteryReturnWarning'
import { GimbalLockChip } from './GimbalLockChip'
import { ForecastWindProvider } from './forecastWind'

/**
 * Laptop-primary layout (see memory: cellular-drone-laptop-first): a slim
 * bar docked to the top (menu, flight metrics, actions) and one to the
 * bottom (commands, preflight), with the map/video edge to edge between
 * them (2026-10-09: the earlier inset frame read as dead space). What's left
 * floats on the map as small corner-anchored panels (banners, progress,
 * planner), compact so they don't compete with the map for attention.
 * Every layout wrapper (the left column, the planner stack) is
 * `pointer-events-none`, and only the
 * panels themselves are `pointer-events-auto`: a column is as wide as its
 * widest child (the HUD strip), so otherwise the empty space beside a
 * narrower panel would swallow map drags, and start a text selection
 * instead. The overlay is `select-none` too, so a drag that starts on a
 * panel can't highlight its text (inputs still edit normally).
 *
 * Mission planning lives here rather than as a separate screen (it used to
 * be — see docs/DECISIONS.md) because a mission is flown by a specific
 * connected vehicle, so planning it away from that context was confusing.
 * "Plan mission" toggles the bottom-left and top-left panels between the
 * normal flight set (checklist, command bar, event log) and the editing set
 * (item list, validation, saved-mission list), and only while planning does
 * a map click insert a waypoint, so it can't happen by accident mid-flight.
 */
/** A bar over the map: only as wide as what it holds, flush to the edges. */
const ISLAND = 'glass-panel absolute z-30 flex items-center px-2'

/** A button in the top bar, styled like the metrics' tiles. */
const BAR_TILE =
  'h-7 shrink-0 whitespace-nowrap rounded-lg bg-secondary glass-tile px-2.5 text-xs font-medium text-[var(--foreground)] transition hover:bg-white/10'

export function FlightScreen({ onBack }: { onBack: () => void }) {
  const [planning, setPlanning] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const gimbal = useGimbalLock()
  const freeFly = useFreeFly()
  const [waypointMenu, setWaypointMenu] = useState<WaypointMenuAnchor | null>(null)
  const closeWaypointMenu = useCallback(() => setWaypointMenu(null), [])
  const freeFlying = !planning && freeFly.active
  const mission = useFlightMission(planning)
  useFlightRecorder(mission)

  const draft = useMissionStore((s) => s.draft)
  // Where to ask for the forecast wind with no drone to ask near: the route.
  const shown = planning ? (draft ?? mission) : mission
  const missionAnchor = useMemo(
    () => shown?.items.map(itemPosition).find((p): p is GeoPoint => p !== null) ?? null,
    [shown],
  )
  const newDraft = useMissionStore((s) => s.newDraft)
  const updateDraft = useMissionStore((s) => s.updateDraft)
  const save = useMissionStore((s) => s.save)
  const connectionState = useVehicleStore((s) => s.connectionState)
  const uploadMission = useVehicleStore((s) => s.uploadMission)

  function enterPlanning() {
    if (!draft) {
      newDraft()
      updateDraft({ name: mission?.name ?? 'New mission', items: mission?.items ?? skeletonItems() })
    }
    setPlanning(true)
  }

  function handleMapClick(point: GeoPoint) {
    if (!draft) return
    updateDraft({ items: insertWaypoint(draft.items, point) })
  }

  async function handleSaveMission() {
    const saved = await save()
    if (!saved || connectionState !== 'connected') return
    // Surfaced rather than ignored: e.g. the vehicle refuses mission changes
    // mid-flight, and silently dropping that left the edited route drawn
    // while the drone kept flying the old one.
    const result = await uploadMission(saved)
    setUploadError(result.ok ? null : `Not sent to vehicle: ${result.detail ?? result.reason}`)
  }

  return (
    <ForecastWindProvider fallback={missionAnchor}>
    <main className="relative h-svh w-full select-none overflow-hidden bg-background">
      {/* The map fills the screen; the bars are islands over only the part
          they cover, flush to the edges, with a rounded inner corner. */}
      <div className="absolute inset-0 overflow-hidden">
        {/* A click adds a waypoint while planning, and otherwise locks the
            gimbal onto the spot. In free fly a double-click adds a waypoint. */}
        <FlightPiP
          mission={mission}
          onMapClick={planning ? handleMapClick : gimbal.lockAt}
          onMapDoubleClick={freeFlying ? freeFly.addWaypoint : undefined}
          onWaypointClick={freeFlying ? (index, at) => setWaypointMenu({ index, ...at }) : undefined}
          focusMap={planning}
        />
      </div>

      {/* Across the top, one island: the menu (☰: missions, logs, link
          detail, simulator), the flight metrics stretched to fill, then past
          a divider the screen's actions, set apart as their own group. */}
      <header className={`${ISLAND} left-2 right-2 top-2 h-11 gap-1 !px-1.5`}>
        <MenuDrawer />
        <HudStrip />
        <div aria-hidden className="mx-2 h-6 w-px shrink-0 bg-white/20" />
        <div className="flex shrink-0 items-center gap-1.5">
          {!planning && <FreeFlyButton className={BAR_TILE} active={freeFly.active} onStart={() => void freeFly.start()} />}
          <button
            type="button"
            onClick={() => (planning ? setPlanning(false) : enterPlanning())}
            className={`${BAR_TILE} ${planning ? 'text-[var(--primary-foreground)] !bg-[var(--primary)] hover:opacity-90' : ''}`}
          >
            {planning ? 'Exit planning' : 'Plan mission'}
          </button>
          <button type="button" onClick={onBack} className={BAR_TILE}>
            Disconnect
          </button>
        </div>
      </header>

      {/* Bottom-left: the commands, then the preflight check while it isn't ready. */}
      <footer className={`${ISLAND} bottom-2 left-2 h-12 max-w-[calc(100%-14rem)] gap-1.5`}>
        <CommandBar mission={mission} />
        <PreflightChecklist mission={mission} />
      </footer>

      <div className="pointer-events-none absolute left-2 right-2 top-[3.75rem] z-20 flex items-start justify-between gap-3">
        <div className="pointer-events-none flex flex-col items-start gap-2 [&>*]:pointer-events-auto">
          <TelemetryStaleBanner />
          <RcOverrideBanner />
          <FailsafeBanners />
          {!planning && <FreeFlyBanner />}
          {!planning && <GimbalLockChip onRelease={() => void gimbal.release()} />}
          {!planning &&
            [gimbal.notice, freeFly.notice].map(
              (notice) =>
                notice && (
                  <div key={notice} role="status" className="glass-panel px-2.5 py-1.5">
                    <span className="hud-label" style={{ color: 'var(--status-warning)' }}>
                      {notice}
                    </span>
                  </div>
                ),
            )}
          {planning && <MissionListPanel />}
        </div>
      </div>

      {/* Bottom-left, just above the commands: the flight's progress (only
          during a mission). The planner's panels take this spot while planning.
          Capped below the HUD and banners, scrolling on a short screen. */}
      {!planning && (
        <div className="absolute bottom-16 left-2 z-20 flex max-h-[calc(100svh-9rem)] flex-col overflow-y-auto">
          <MissionProgressPanel mission={mission} />
        </div>
      )}

      {/* While planning, capped below the HUD and saved-missions list and
          scrolling as a whole: the planner's panels stack up from the
          bottom and would otherwise climb over them on a short screen. */}
      {planning && draft && (
        <div className="absolute bottom-16 left-2 z-20 flex max-h-[calc(100svh-15rem)] max-w-xl flex-col gap-2 overflow-y-auto [&>*]:shrink-0">
          <MissionValidationPanel mission={draft} />
          <MissionProfilePanel mission={draft} onChangeItems={(items) => updateDraft({ items })} />
          {uploadError && (
            <div role="alert" className="glass-panel px-2.5 py-1.5">
              <span className="hud-label" style={{ color: 'var(--status-critical)' }}>
                {uploadError}
              </span>
            </div>
          )}
          <MissionItemListPanel
            mission={draft}
            onChangeItems={(items) => updateDraft({ items })}
            onRename={(name) => updateDraft({ name })}
            onSave={handleSaveMission}
          />
        </div>
      )}
      {/* Over everything: the battery is nearly down to the trip home. */}
      <BatteryReturnWarning />
      {freeFlying && waypointMenu && (
        <WaypointMenu
          anchor={waypointMenu}
          onClose={closeWaypointMenu}
          onRemove={(index, at) => void freeFly.remove(index, at)}
          onSetLoiter={(index, at, loiter) => void freeFly.setLoiter(index, at, loiter)}
        />
      )}
    </main>
    </ForecastWindProvider>
  )
}
