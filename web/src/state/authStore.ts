import { createStore } from 'zustand/vanilla'
import type { AuthClient, AuthUser } from '../services'
import { UnauthorizedError } from '../services'

export interface AuthState {
  user: AuthUser | null
  status: 'idle' | 'loading'
  error: string | null
  login(username: string, password: string): Promise<boolean>
  logout(): Promise<void>
}

export function createAuthStore(client: AuthClient) {
  return createStore<AuthState>((set) => ({
    user: null,
    status: 'idle',
    error: null,

    async login(username, password) {
      set({ status: 'loading', error: null })
      try {
        const user = await client.login(username, password)
        set({ user, status: 'idle', error: null })
        return true
      } catch (err) {
        const message = err instanceof UnauthorizedError ? err.message : 'Login failed'
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
