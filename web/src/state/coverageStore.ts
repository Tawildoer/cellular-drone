import { createStore } from 'zustand/vanilla'
import { addCoverageSample, indexCoverage, type CoverageIndex, type CoverageSample } from '../domain'
import type { CoverageRepository } from '../services'

export interface CoverageStoreState {
  samples: CoverageSample[]
  /** The samples by grid square, rebuilt as they change. */
  index: CoverageIndex
  load(): Promise<void>
  add(sample: CoverageSample): void
  clear(): Promise<void>
}

/** Saved at most this often while a flight adds readings. */
const SAVE_EVERY_MS = 10_000

export function createCoverageStore(repo: CoverageRepository) {
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  return createStore<CoverageStoreState>((set, get) => ({
    samples: [],
    index: new Map(),
    async load() {
      const samples = await repo.load()
      set({ samples, index: indexCoverage(samples) })
    },
    add(sample) {
      const samples = addCoverageSample(get().samples, sample)
      set({ samples, index: indexCoverage(samples) })
      saveTimer ??= setTimeout(() => {
        saveTimer = undefined
        void repo.save(get().samples)
      }, SAVE_EVERY_MS)
    },
    async clear() {
      clearTimeout(saveTimer)
      saveTimer = undefined
      await repo.clear()
      set({ samples: [], index: new Map() })
    },
  }))
}

export type CoverageStore = ReturnType<typeof createCoverageStore>
