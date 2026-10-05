import { describe, expect, it } from 'vitest'
import { MockAuthClient } from '../../services/mock'
import { createAuthStore } from '../authStore'

describe('authStore', () => {
  it('starts logged out', () => {
    const store = createAuthStore(new MockAuthClient({ username: 'operator', password: 'secret' }))
    expect(store.getState().user).toBeNull()
  })

  it('logs in with valid credentials', async () => {
    const store = createAuthStore(new MockAuthClient({ username: 'operator', password: 'secret' }))
    const ok = await store.getState().login('operator', 'secret')

    expect(ok).toBe(true)
    expect(store.getState().user).toEqual({ username: 'operator' })
    expect(store.getState().error).toBeNull()
  })

  it('surfaces an error on bad credentials without throwing', async () => {
    const store = createAuthStore(new MockAuthClient({ username: 'operator', password: 'secret' }))
    const ok = await store.getState().login('operator', 'wrong')

    expect(ok).toBe(false)
    expect(store.getState().user).toBeNull()
    expect(store.getState().error).toBeTruthy()
  })

  it('clears the session on logout', async () => {
    const store = createAuthStore(new MockAuthClient({ username: 'operator', password: 'secret' }))
    await store.getState().login('operator', 'secret')
    await store.getState().logout()

    expect(store.getState().user).toBeNull()
  })
})
