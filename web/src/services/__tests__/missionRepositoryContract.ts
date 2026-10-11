import { beforeEach, describe, expect, it } from 'vitest'
import type { Mission } from '../../domain'
import type { MissionRepository } from '../MissionRepository'

export function draftMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: '',
    name: 'test mission',
    items: [{ type: 'vtolTakeoff', altM: 50 }, { type: 'returnToLaunch' }],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

/**
 * What every MissionRepository must do, whatever stores it (FRONTEND.md:
 * implementations share contract tests). `create` returns an empty one.
 */
export function missionRepositoryContract(name: string, create: () => MissionRepository | Promise<MissionRepository>) {
  describe(`${name} (MissionRepository contract)`, () => {
    let repo: MissionRepository

    beforeEach(async () => {
      repo = await create()
    })

    it('starts empty', async () => {
      expect(await repo.list()).toEqual([])
    })

    it('assigns an id and timestamps on first save', async () => {
      const saved = await repo.save(draftMission())
      expect(saved.id).toBeTruthy()
      expect(saved.createdAt).toBeGreaterThan(0)
      expect(saved.updatedAt).toBeGreaterThan(0)
    })

    it('round-trips a saved mission through get()', async () => {
      const saved = await repo.save(draftMission({ name: 'survey' }))
      expect(await repo.get(saved.id)).toEqual(saved)
    })

    it('returns null for a missing id', async () => {
      expect(await repo.get('does-not-exist')).toBeNull()
    })

    it('updates in place on a second save with the same id', async () => {
      const first = await repo.save(draftMission({ name: 'v1' }))
      const second = await repo.save({ ...first, name: 'v2' })

      expect(second.id).toBe(first.id)
      expect(second.createdAt).toBe(first.createdAt)
      expect((await repo.get(first.id))?.name).toBe('v2')
      expect(await repo.list()).toHaveLength(1)
    })

    it('lists missions newest-updated first', async () => {
      const a = await repo.save(draftMission({ name: 'a' }))
      await new Promise((r) => setTimeout(r, 2))
      const b = await repo.save(draftMission({ name: 'b' }))

      expect((await repo.list()).map((m) => m.id)).toEqual([b.id, a.id])
    })

    it('deletes a mission', async () => {
      const saved = await repo.save(draftMission())
      await repo.delete(saved.id)

      expect(await repo.get(saved.id)).toBeNull()
      expect(await repo.list()).toEqual([])
    })

    it('does not throw when deleting a missing id', async () => {
      await expect(repo.delete('nope')).resolves.toBeUndefined()
    })
  })
}
