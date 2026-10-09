import { useState } from 'react'
import { useMissionStore, useVehicleStore } from '../../app/store-hooks'
import { CommandBar } from '../command-bar/CommandBar'
import { PreflightChecklist } from '../checklist/PreflightChecklist'
import { Button } from '../../components/ui/button'
import type { GeoPoint } from '../../domain'
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

/**
 * Laptop-primary layout (see memory: cellular-drone-laptop-first): the map/
 * video fills the screen inside a bordered frame (edge-to-edge felt
 * overwhelming) and everything else floats on top as small, corner-anchored
 * overlay panels — kept deliberately compact rather than large blocks, so
 * they read as pop-out widgets, not a layer that competes with the map for
 * attention. Every layout wrapper (the full-width top bar, the left column,
 * the button group, the bottom stack) is `pointer-events-none`, and only the
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
export function FlightScreen({ onBack }: { onBack: () => void }) {
  const [planning, setPlanning] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const mission = useFlightMission(planning)
  useFlightRecorder(mission)

  const draft = useMissionStore((s) => s.draft)
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
    <main className="relative h-svh w-full select-none overflow-hidden bg-background">
      {/* The top bar: menu, the flight metrics in one compact row, and the
          screen's actions. Docked to the top edge; the map starts below it. */}
      <header className="absolute inset-x-0 top-0 z-30 flex h-11 items-center gap-2 border-b border-border/60 bg-background px-3">
        {/* The menu (☰) holds what's looked at now and then: missions,
            logs, link detail, simulator. The map keeps only what flying needs. */}
        <MenuDrawer />
        <HudStrip />
        <span className="flex-1" />
        <Button
          type="button"
          variant={planning ? 'default' : 'ghost'}
          size="sm"
          onClick={() => (planning ? setPlanning(false) : enterPlanning())}
          className="shrink-0"
        >
          {planning ? 'Exit planning' : 'Plan mission'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onBack} className="shrink-0">
          Disconnect
        </Button>
      </header>

      {/* Flush under the top bar (no gap), framed on the other three sides. */}
      <div className="absolute inset-x-3 bottom-3 top-11 overflow-hidden rounded-b-[var(--panel-radius)] border border-t-0 border-border/60">
        <FlightPiP mission={mission} onMapClick={planning ? handleMapClick : undefined} focusMap={planning} />
      </div>

      <div className="pointer-events-none absolute left-6 right-6 top-[3.5rem] z-20 flex items-start justify-between gap-3">
        <div className="pointer-events-none flex flex-col items-start gap-2 [&>*]:pointer-events-auto">
          <TelemetryStaleBanner />
          <RcOverrideBanner />
          <FailsafeBanners />
          {planning ? <MissionListPanel /> : <MissionProgressPanel mission={mission} />}
        </div>
      </div>

      {/* While planning, capped below the HUD and saved-missions list and
          scrolling as a whole: the planner's panels stack up from the
          bottom and would otherwise climb over them on a short screen. */}
      <div
        className={`absolute bottom-6 left-6 z-20 flex max-w-xl flex-col gap-2 ${
          // Planning keeps its own pointer events so its scrollbar can be dragged.
          planning ? 'max-h-[calc(100svh-15rem)] overflow-y-auto [&>*]:shrink-0' : 'pointer-events-none [&>*]:pointer-events-auto'
        }`}
      >
        {planning && draft ? (
          <>
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
          </>
        ) : (
          <>
            <PreflightChecklist mission={mission} />
            <CommandBar mission={mission} />
          </>
        )}
      </div>
    </main>
  )
}
