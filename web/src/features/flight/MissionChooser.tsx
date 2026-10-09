import { Check } from 'lucide-react'
import { useEffect } from 'react'
import { useMissionStore, useVehicleStore } from '../../app/store-hooks'

/**
 * Picks which saved mission is active without entering planning mode:
 * selecting one loads it as the draft and, if connected, uploads it so
 * "Hold to start mission" flies the one just picked. While connected, the
 * mission marked active is the one the vehicle accepted, so a selection it
 * rejected (e.g. mid-flight) doesn't look like it took effect.
 */
export function MissionChooser() {
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

  const activeMission = connectionState === 'connected' ? missionOnVehicle : (draft ?? missions[0] ?? null)

  async function handleSelect(id: string) {
    const selected = missions.find((m) => m.id === id)
    if (!selected) return
    await load(id)
    if (connectionState === 'connected') void uploadMission(selected)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 text-xs">
        <span className="hud-label">Active</span>
        <span className="truncate" style={{ color: 'var(--foreground)' }} data-testid="active-mission">
          {activeMission?.name ?? 'None selected'}
        </span>
      </div>
      {missions.length === 0 ? (
        <p className="text-xs opacity-70">No saved missions. Plan one with “Plan mission”.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {missions.map((m) => {
            const isActive = m.id === activeMission?.id
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => void handleSelect(m.id)}
                  aria-pressed={isActive}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition hover:bg-white/5"
                  style={{ color: isActive ? 'var(--primary)' : 'var(--foreground)', background: isActive ? 'var(--accent)' : undefined }}
                >
                  <span className="flex-1 truncate">{m.name}</span>
                  {isActive && <Check size={12} aria-hidden />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
