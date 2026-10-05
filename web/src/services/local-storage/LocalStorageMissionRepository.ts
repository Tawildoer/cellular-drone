import type { Mission } from '../../domain'
import type { MissionRepository } from '../MissionRepository'

export interface LocalStorageMissionRepositoryOptions {
  storageKey?: string
  storage?: Storage
}

const DEFAULT_STORAGE_KEY = 'cellular-drone:missions'

export class LocalStorageMissionRepository implements MissionRepository {
  private readonly storageKey: string
  private readonly storage: Storage

  constructor(opts: LocalStorageMissionRepositoryOptions = {}) {
    this.storageKey = opts.storageKey ?? DEFAULT_STORAGE_KEY
    this.storage = opts.storage ?? globalThis.localStorage
  }

  async list(): Promise<Mission[]> {
    return Object.values(this.readAll()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(id: string): Promise<Mission | null> {
    return this.readAll()[id] ?? null
  }

  async save(mission: Mission): Promise<Mission> {
    const all = this.readAll()
    const now = Date.now()
    const stored: Mission = {
      ...mission,
      id: mission.id || crypto.randomUUID(),
      createdAt: mission.createdAt || now,
      updatedAt: now,
    }

    all[stored.id] = stored
    this.writeAll(all)
    return stored
  }

  async delete(id: string): Promise<void> {
    const all = this.readAll()
    delete all[id]
    this.writeAll(all)
  }

  private readAll(): Record<string, Mission> {
    const raw = this.storage.getItem(this.storageKey)
    if (!raw) return {}

    try {
      return JSON.parse(raw) as Record<string, Mission>
    } catch {
      return {}
    }
  }

  private writeAll(all: Record<string, Mission>): void {
    this.storage.setItem(this.storageKey, JSON.stringify(all))
  }
}
