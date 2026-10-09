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
import { EventLogPopout } from './EventLogPopout'
import { FlightPiP } from './FlightPiP'
import { HudStrip } from './HudStrip'
import { LinkQualityPopout } from './LinkQualityPopout'
import { MissionProgressPanel } from './MissionProgressPanel'
import { MissionSelector } from './MissionSelector'
import { RcOverrideBanner } from './RcOverrideBanner'
import { FailsafeBanners, TelemetryStaleBanner } from './StatusBanners'
import { useFlightMission } from './useFlightMission'

/**
 * Laptop-primary layout (see memory: cellular-drone-laptop-first): the map/
 * video fills the screen inside a bordered frame (edge-to-edge felt
 * overwhelming) and everything else floats on top as small, corner-anchored
 * overlay panels — kept deliberately compact rather than large blocks, so
 * they read as pop-out widgets, not a layer that competes with the map for
 * attention. The top bar's wrapper spans the full width so its children can
 * be `justify-between`, so it (and nothing inside it needs to be)
 * is `pointer-events-none` with `pointer-events-auto` on the actual panels —
 * otherwise the empty space between them would swallow map drag/click
 * gestures that should fall through to the map underneath.
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
    <main className="relative h-svh w-full overflow-hidden bg-background">
      <div className="absolute inset-3 overflow-hidden rounded-[var(--panel-radius)] border border-border/60">
        <FlightPiP mission={mission} onMapClick={planning ? handleMapClick : undefined} focusMap={planning} />
      </div>

      <div className="pointer-events-none absolute left-6 right-6 top-6 z-20 flex items-start justify-between gap-3">
        <div className="pointer-events-auto flex flex-col items-start gap-2">
          <TelemetryStaleBanner />
          <RcOverrideBanner />
          <FailsafeBanners />
          <HudStrip />
          {planning ? (
            <MissionListPanel />
          ) : (
            <>
              <MissionProgressPanel mission={mission} />
              <MissionSelector />
              <EventLogPopout />
              <LinkQualityPopout />
            </>
          )}
        </div>

        <div className="pointer-events-auto flex shrink-0 gap-2">
          <Button
            type="button"
            variant={planning ? 'default' : 'ghost'}
            size="sm"
            onClick={() => (planning ? setPlanning(false) : enterPlanning())}
            className="glass-panel"
          >
            {planning ? 'Exit planning' : 'Plan mission'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onBack} className="glass-panel">
            Disconnect
          </Button>
        </div>
      </div>

      {/* While planning, capped below the HUD and saved-missions list and
          scrolling as a whole: the planner's panels stack up from the
          bottom and would otherwise climb over them on a short screen. */}
      <div
        className={`absolute bottom-6 left-6 z-20 flex max-w-xl flex-col gap-2 ${
          planning ? 'max-h-[calc(100svh-15rem)] overflow-y-auto [&>*]:shrink-0' : ''
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
