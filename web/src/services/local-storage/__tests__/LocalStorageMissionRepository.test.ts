import { beforeEach, describe, expect, it } from 'vitest'
import { draftMission, missionRepositoryContract } from '../../__tests__/missionRepositoryContract'
import { LocalStorageMissionRepository } from '../LocalStorageMissionRepository'

missionRepositoryContract('LocalStorageMissionRepository', () => {
  localStorage.clear()
  return new LocalStorageMissionRepository({ storageKey: 'test:missions' })
})

describe('LocalStorageMissionRepository', () => {
  let repo: LocalStorageMissionRepository

  beforeEach(() => {
    localStorage.clear()
    repo = new LocalStorageMissionRepository({ storageKey: 'test:missions' })
  })

  it('recovers from corrupted storage instead of throwing', async () => {
    localStorage.setItem('test:missions', '{not json')
    expect(await repo.list()).toEqual([])
  })

  it('keeps separate repositories isolated by storage key', async () => {
    const other = new LocalStorageMissionRepository({ storageKey: 'other:missions' })
    await repo.save(draftMission({ name: 'in repo' }))

    expect(await other.list()).toEqual([])
  })
})
