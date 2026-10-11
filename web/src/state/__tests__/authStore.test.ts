import { describe, expect, it } from 'vitest'
import { RateLimitedError } from '../../services'
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

describe('authStore restore', () => {
  it('picks up a session that outlived a reload', async () => {
    const client = new MockAuthClient({ username: 'operator', password: 'secret' })
    await client.login('operator', 'secret')
    const store = createAuthStore(client)
    const restoring = store.getState().restore()
    expect(store.getState().status).toBe('restoring')
    await restoring
    expect(store.getState()).toMatchObject({ user: { username: 'operator' }, status: 'idle' })
  })

  it('stays signed out when there is no session, or the backend is down', async () => {
    const store = createAuthStore(new MockAuthClient())
    await store.getState().restore()
    expect(store.getState()).toMatchObject({ user: null, status: 'idle' })

    const down = createAuthStore({
      login: () => Promise.reject(new Error('down')),
      logout: () => Promise.resolve(),
      me: () => Promise.reject(new Error('down')),
    })
    await down.getState().restore()
    expect(down.getState()).toMatchObject({ user: null, status: 'idle' })
  })

  it('shows the rate-limit message from the backend', async () => {
    const store = createAuthStore({
      login: () => Promise.reject(new RateLimitedError()),
      logout: () => Promise.resolve(),
      me: () => Promise.resolve(null),
    })
    await store.getState().login('operator', 'x')
    expect(store.getState().error).toMatch(/too many/i)
  })
})
