import type { Mission } from '../domain'

export interface MissionRepository {
  list(): Promise<Mission[]>
  get(id: string): Promise<Mission | null>
  /** Creates (empty `id`) or updates a mission, returning the stored copy. */
  save(mission: Mission): Promise<Mission>
  delete(id: string): Promise<void>
}
