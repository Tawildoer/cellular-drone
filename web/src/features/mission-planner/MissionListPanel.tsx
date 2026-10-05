import { useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useMissionStore } from '../../app/store-hooks'
import { Button } from '../../components/ui/button'
import { skeletonItems } from './missionEdit'

export function MissionListPanel() {
  const missions = useMissionStore((s) => s.missions)
  const draft = useMissionStore((s) => s.draft)
  const refresh = useMissionStore((s) => s.refresh)
  const load = useMissionStore((s) => s.load)
  const newDraft = useMissionStore((s) => s.newDraft)
  const updateDraft = useMissionStore((s) => s.updateDraft)
  const remove = useMissionStore((s) => s.remove)

  useEffect(() => {
    void refresh()
  }, [refresh])

  function handleNew() {
    newDraft()
    updateDraft({ name: 'New mission', items: skeletonItems() })
  }

  return (
    <div className="glass-panel flex max-h-[42vh] w-56 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/60 px-2.5 py-1.5">
        <span className="hud-label">Missions</span>
        <Button type="button" size="sm" variant="secondary" onClick={handleNew} aria-label="New mission">
          <Plus size={12} aria-hidden />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-1.5">
        {missions.length === 0 ? (
          <span className="hud-label">No saved missions</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {missions.map((mission) => {
              const isActive = mission.id === draft?.id
              return (
                <li key={mission.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void load(mission.id)}
                    className="flex-1 truncate text-left text-xs transition hover:opacity-80"
                    style={{ color: isActive ? 'var(--primary)' : 'var(--foreground)' }}
                  >
                    {mission.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(mission.id)}
                    aria-label={`Delete ${mission.name}`}
                    className="shrink-0 transition hover:opacity-70"
                  >
                    <Trash2 size={12} style={{ color: 'var(--status-critical)' }} aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
