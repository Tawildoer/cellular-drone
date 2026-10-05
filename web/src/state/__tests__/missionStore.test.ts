import { beforeEach, describe, expect, it } from 'vitest'
import { LocalStorageMissionRepository } from '../../services/local-storage'
import { createMissionStore } from '../missionStore'

describe('missionStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('starts with an empty list', async () => {
    const store = createMissionStore(new LocalStorageMissionRepository({ storageKey: 'test:missions' }))
    await store.getState().refresh()
    expect(store.getState().missions).toEqual([])
  })

  it('creates a draft, saves it, and lists it', async () => {
    const store = createMissionStore(new LocalStorageMissionRepository({ storageKey: 'test:missions' }))

    store.getState().newDraft()
    store.getState().updateDraft({ name: 'survey 1' })
    const saved = await store.getState().save()

    expect(saved?.name).toBe('survey 1')
    expect(store.getState().missions).toHaveLength(1)
    expect(store.getState().missions[0]?.name).toBe('survey 1')
  })

  it('loads an existing mission into the draft', async () => {
    const repo = new LocalStorageMissionRepository({ storageKey: 'test:missions' })
    const stored = await repo.save({ id: '', name: 'to load', items: [], createdAt: 0, updatedAt: 0 })

    const store = createMissionStore(repo)
    await store.getState().load(stored.id)

    expect(store.getState().draft).toEqual(stored)
  })

  it('does nothing when saving without a draft', async () => {
    const store = createMissionStore(new LocalStorageMissionRepository({ storageKey: 'test:missions' }))
    expect(await store.getState().save()).toBeNull()
  })

  it('removes a mission and refreshes the list', async () => {
    const store = createMissionStore(new LocalStorageMissionRepository({ storageKey: 'test:missions' }))
    store.getState().newDraft()
    const saved = await store.getState().save()

    await store.getState().remove(saved!.id)

    expect(store.getState().missions).toEqual([])
  })
})
