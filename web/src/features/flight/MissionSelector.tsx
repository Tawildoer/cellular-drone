import { ChevronDown, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useMissionStore, useVehicleStore } from '../../app/store-hooks'

const ROW_HEIGHT = 'h-9'

/**
 * Lets the operator pick which saved mission is active without entering
 * planning mode — selecting one loads it as the draft and, if connected,
 * uploads it so "Hold to start mission" actually flies the one just picked.
 * The map/checklist follow once the vehicle accepts it (useFlightMission).
 */
export function MissionSelector() {
  const [open, setOpen] = useState(false)
  const missions = useMissionStore((s) => s.missions)
  const draft = useMissionStore((s) => s.draft)
  const refresh = useMissionStore((s) => s.refresh)
  const load = useMissionStore((s) => s.load)
  const connectionState = useVehicleStore((s) => s.connectionState)
  const uploadMission = useVehicleStore((s) => s.uploadMission)
  const missionOnVehicle = useVehicleStore((s) => s.missionOnVehicle)

  useEffect(() => {
    void refresh()
  }, [refresh])

  // While connected, name what the vehicle will actually fly — a selection
  // it rejected (e.g. mid-flight) must not look like it took effect.
  const activeMission = connectionState === 'connected' ? missionOnVehicle : (draft ?? missions[0] ?? null)

  async function handleSelect(id: string) {
    const selected = missions.find((m) => m.id === id)
    if (!selected) return
    await load(id)
    if (connectionState === 'connected') void uploadMission(selected)
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Choose active mission"
        className={`glass-panel flex ${ROW_HEIGHT} max-w-[14rem] items-center gap-1.5 px-2.5 transition hover:ring-2 hover:ring-primary`}
      >
        <span className="hud-label shrink-0">Mission</span>
        <span className="truncate text-xs" style={{ color: 'var(--foreground)' }}>
          {activeMission?.name ?? 'None selected'}
        </span>
        <ChevronDown size={12} style={{ color: 'var(--primary)' }} aria-hidden className="shrink-0" />
      </button>
    )
  }

  return (
    <div className="glass-panel flex w-64 flex-col overflow-hidden">
      <div className={`flex ${ROW_HEIGHT} items-center justify-between border-b border-border/60 px-2.5`}>
        <span className="hud-label">Choose mission</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close mission chooser" className="transition hover:opacity-70">
          <X size={14} style={{ color: 'var(--primary)' }} aria-hidden />
        </button>
      </div>

      <div className="flex max-h-[30vh] flex-col gap-1 overflow-y-auto px-2.5 py-1.5">
        {missions.length === 0 ? (
          <span className="hud-label">No saved missions</span>
        ) : (
          missions.map((m) => {
            const isActive = m.id === activeMission?.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => void handleSelect(m.id)}
                aria-pressed={isActive}
                className="truncate rounded px-1.5 py-1 text-left text-xs transition hover:opacity-80"
                style={{ color: isActive ? 'var(--primary)' : 'var(--foreground)', background: isActive ? 'var(--accent)' : undefined }}
              >
                {m.name}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
