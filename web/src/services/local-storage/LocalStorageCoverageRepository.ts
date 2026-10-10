import type { CoverageSample } from '../../domain'
import type { CoverageRepository } from '../CoverageRepository'

export interface LocalStorageCoverageRepositoryOptions {
  storageKey?: string
  storage?: Storage
}

const DEFAULT_STORAGE_KEY = 'cellular-drone:coverage'

/** This browser's coverage map. Later the server could pool every flight's. */
export class LocalStorageCoverageRepository implements CoverageRepository {
  private readonly storageKey: string
  private readonly storage: Storage

  constructor(opts: LocalStorageCoverageRepositoryOptions = {}) {
    this.storageKey = opts.storageKey ?? DEFAULT_STORAGE_KEY
    this.storage = opts.storage ?? globalThis.localStorage
  }

  async load(): Promise<CoverageSample[]> {
    const raw = this.storage.getItem(this.storageKey)
    if (!raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as CoverageSample[]) : []
    } catch {
      return []
    }
  }

  async save(samples: CoverageSample[]): Promise<void> {
    this.storage.setItem(this.storageKey, JSON.stringify(samples))
  }

  async clear(): Promise<void> {
    this.storage.removeItem(this.storageKey)
  }
}
