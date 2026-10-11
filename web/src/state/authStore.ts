import { createStore } from 'zustand/vanilla'
import type { AuthClient, AuthUser } from '../services'
import { RateLimitedError, UnauthorizedError } from '../services'

export interface AuthState {
  user: AuthUser | null
  /** 'restoring' while checking for a session that outlived a reload. */
  status: 'idle' | 'loading' | 'restoring'
  error: string | null
  /** Picks up an existing session (the server's cookie), if there is one. */
  restore(): Promise<void>
  login(username: string, password: string): Promise<boolean>
  logout(): Promise<void>
}

export function createAuthStore(client: AuthClient) {
  return createStore<AuthState>((set, get) => ({
    user: null,
    status: 'idle',
    error: null,

    async restore() {
      set({ status: 'restoring' })
      let user = null
      try {
        user = await client.me()
      } catch {
        // Server unreachable: show the login screen, which reports it on use.
      }
      // A login that finished meanwhile wins.
      if (get().status === 'restoring') set({ user: get().user ?? user, status: 'idle' })
    },

    async login(username, password) {
      set({ status: 'loading', error: null })
      try {
        const user = await client.login(username, password)
        set({ user, status: 'idle', error: null })
        return true
      } catch (err) {
        const message = err instanceof UnauthorizedError || err instanceof RateLimitedError ? err.message : 'Login failed'
        set({ status: 'idle', error: message })
        return false
      }
    },

    async logout() {
      await client.logout()
      set({ user: null, status: 'idle', error: null })
    },
  }))
}

export type AuthStore = ReturnType<typeof createAuthStore>
