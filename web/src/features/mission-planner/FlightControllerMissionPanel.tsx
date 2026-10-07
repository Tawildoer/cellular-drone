import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Download, Info, XCircle } from 'lucide-react'
import { useMissionTranslator, useVehicleStore } from '../../app/store-hooks'
import { Button } from '../../components/ui/button'
import type { Mission } from '../../domain'
import type { FlightControllerRow, MissionTranslationIssue } from '../../services'

const SEVERITY_ORDER: MissionTranslationIssue['severity'][] = ['info', 'warning', 'error']

const SEVERITY_STYLE: Record<MissionTranslationIssue['severity'], { color: string; Icon: typeof Info }> = {
  error: { color: 'var(--status-critical)', Icon: XCircle },
  warning: { color: 'var(--status-warning)', Icon: AlertTriangle },
  info: { color: 'var(--muted-foreground)', Icon: Info },
}

function worstSeverity(issues: MissionTranslationIssue[]): MissionTranslationIssue['severity'] | null {
  let worst: MissionTranslationIssue['severity'] | null = null
  for (const issue of issues) {
    if (!worst || SEVERITY_ORDER.indexOf(issue.severity) > SEVERITY_ORDER.indexOf(worst)) worst = issue.severity
  }
  return worst
}

function downloadText(filename: string, mimeType: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function RowList({ rows, issues }: { rows: FlightControllerRow[]; issues: MissionTranslationIssue[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row) => {
        const severity = row.appIndex === null ? null : worstSeverity(issues.filter((i) => i.itemIndex === row.appIndex))
        return (
          <li key={row.seq} className="flex items-baseline gap-2 text-xs">
            <span className="hud-label w-4 shrink-0 text-right">{row.seq}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-mono" style={severity ? { color: SEVERITY_STYLE[severity].color } : undefined}>
                {row.command}
              </span>
              <span className="truncate opacity-70" title={row.detail}>
                {row.appIndex !== null ? `item ${row.appIndex + 1} · ` : ''}
                {row.detail}
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * How the plan looks to the flight controller (ADR-0017): the mission rows
 * the agent will upload, anything ArduPilot would store or fly differently,
 * whether the vehicle's read-back copy matches, and a file Mission Planner /
 * QGroundControl / MAVProxy can load. A preview — the agent does the real
 * translation on upload.
 */
export function FlightControllerMissionPanel({ mission }: { mission: Mission }) {
  const translator = useMissionTranslator()
  const home = useVehicleStore((s) => s.vehicleState?.home ?? null)
  const missionOnVehicle = useVehicleStore((s) => s.missionOnVehicle)
  const readback = useVehicleStore((s) => s.missionOnVehicleReadback)
  const [open, setOpen] = useState(false)
  const [showVehicleCopy, setShowVehicleCopy] = useState(false)

  const preview = translator.preview(mission, home)
  const worst = worstSeverity(preview.issues.filter((i) => i.severity !== 'info'))
  const WorstIcon = worst ? SEVERITY_STYLE[worst].Icon : null
  const onVehicle = missionOnVehicle?.id === mission.id
  const vehicleMatches = onVehicle && readback ? translator.matches(preview.raw, readback) : null
  const shownRows = showVehicleCopy && readback ? translator.describe(readback) : preview.rows

  function handleExport() {
    const file = translator.exportFile(mission, home)
    downloadText(file.filename, file.mimeType, file.text)
  }

  return (
    <div className="glass-panel flex max-h-[42vh] w-80 flex-col overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-left"
      >
        {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
        <span className="hud-label flex-1">
          {translator.flightStack} mission · {preview.rows.length} rows
          {preview.fenceVertexCount > 0 ? ` · fence ${preview.fenceVertexCount} pts` : ''}
        </span>
        {worst && WorstIcon && (
          <WorstIcon size={12} style={{ color: SEVERITY_STYLE[worst].color }} aria-label={`${translator.flightStack} ${worst}s`} />
        )}
        {vehicleMatches !== null && (
          <span
            className="hud-label"
            style={{ color: vehicleMatches ? 'var(--status-good)' : 'var(--status-warning)' }}
          >
            {vehicleMatches ? 'on vehicle' : 'vehicle differs'}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="flex-1 overflow-y-auto border-t border-border/60 px-2.5 py-1.5">
            <RowList rows={shownRows} issues={showVehicleCopy ? [] : preview.issues} />
            {Object.keys(preview.params).length > 0 && (
              <p className="mt-1.5 text-xs opacity-70">
                Params: {Object.entries(preview.params).map(([name, value]) => `${name}=${value}`).join(', ')}
              </p>
            )}
            {preview.issues.length > 0 && (
              <ul className="mt-1.5 flex flex-col gap-1 border-t border-border/60 pt-1.5">
                {preview.issues.map((issue, i) => {
                  const { color, Icon } = SEVERITY_STYLE[issue.severity]
                  return (
                    <li key={i} className="flex gap-1.5 text-xs" style={{ color }}>
                      <Icon size={12} className="mt-0.5 shrink-0" aria-hidden />
                      <span>
                        {issue.itemIndex !== null ? `Item ${issue.itemIndex + 1}: ` : ''}
                        {issue.message}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="flex items-center gap-1.5 border-t border-border/60 px-2.5 py-1.5">
            <span className="hud-label flex-1">
              {vehicleMatches === null
                ? onVehicle
                  ? 'Vehicle sent no readback'
                  : 'Preview · not on vehicle'
                : vehicleMatches
                  ? 'Vehicle readback matches'
                  : 'Vehicle copy differs from this plan'}
            </span>
            {readback && onVehicle && (
              <button
                type="button"
                onClick={() => setShowVehicleCopy((s) => !s)}
                aria-pressed={showVehicleCopy}
                className="hud-label rounded px-1.5 py-0.5 transition"
                style={showVehicleCopy ? { color: 'var(--primary)', background: 'var(--accent)' } : undefined}
              >
                Vehicle copy
              </button>
            )}
            <Button type="button" size="sm" variant="secondary" onClick={handleExport}>
              <Download size={12} aria-hidden />
              .waypoints
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
