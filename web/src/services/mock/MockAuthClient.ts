import type { AuthClient, AuthUser } from '../AuthClient'
import { UnauthorizedError } from '../AuthClient'

export interface MockAuthClientOptions {
  username?: string
  password?: string
}

export const DEFAULT_USERNAME = 'operator'
export const DEFAULT_PASSWORD = 'changeme'

/** Dev-only AuthClient. Credentials come from .env.local (VITE_DEV_USERNAME /
 * VITE_DEV_PASSWORD) so nothing real is ever committed — see CLAUDE.md. */
export class MockAuthClient implements AuthClient {
  private readonly username: string
  private readonly password: string
  private loggedInUser: AuthUser | null = null

  constructor(opts: MockAuthClientOptions = {}) {
    this.username = opts.username ?? import.meta.env.VITE_DEV_USERNAME ?? DEFAULT_USERNAME
    this.password = opts.password ?? import.meta.env.VITE_DEV_PASSWORD ?? DEFAULT_PASSWORD
  }

  async login(username: string, password: string): Promise<AuthUser> {
    if (username !== this.username || password !== this.password) {
      throw new UnauthorizedError('Invalid username or password')
    }
    this.loggedInUser = { username }
    return this.loggedInUser
  }

  async logout(): Promise<void> {
    this.loggedInUser = null
  }

  async me(): Promise<AuthUser | null> {
    return this.loggedInUser
  }
}
