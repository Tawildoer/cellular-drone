import { createStore } from 'zustand/vanilla'
import type { Mission } from '../domain'
import type { MissionRepository } from '../services'

export interface MissionStoreState {
  missions: Mission[]
  draft: Mission | null
  loading: boolean
  error: string | null

  refresh(): Promise<void>
  load(id: string): Promise<void>
  newDraft(): void
  updateDraft(patch: Partial<Mission>): void
  save(): Promise<Mission | null>
  remove(id: string): Promise<void>
}

export function createMissionStore(repo: MissionRepository) {
  return createStore<MissionStoreState>((set, get) => ({
    missions: [],
    draft: null,
    loading: false,
    error: null,

    async refresh() {
      set({ loading: true, error: null })
      try {
        const missions = await repo.list()
        set({ missions, loading: false })
      } catch {
        set({ loading: false, error: 'Failed to load missions' })
      }
    },

    async load(id) {
      const mission = await repo.get(id)
      set({ draft: mission })
    },

    newDraft() {
      set({ draft: { id: '', name: 'New mission', items: [], createdAt: 0, updatedAt: 0 } })
    },

    updateDraft(patch) {
      set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : s))
    },

    async save() {
      const draft = get().draft
      if (!draft) return null
      const saved = await repo.save(draft)
      set({ draft: saved })
      await get().refresh()
      return saved
    },

    async remove(id) {
      await repo.delete(id)
      await get().refresh()
    },
  }))
}

export type MissionStore = ReturnType<typeof createMissionStore>
