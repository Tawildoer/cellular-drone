import type { AuthClient, AuthUser } from '../AuthClient'
import { RateLimitedError, UnauthorizedError } from '../AuthClient'
import { createRequester, errorFrom, type HttpOptions } from './request'

/** Password login against the server (server/src/auth.ts): a session cookie
 * the browser holds, so a reload stays signed in until it expires. */
export class HttpAuthClient implements AuthClient {
  private readonly request: ReturnType<typeof createRequester>

  constructor(opts: HttpOptions = {}) {
    this.request = createRequester(opts)
  }

  async login(username: string, password: string): Promise<AuthUser> {
    const res = await this.request('POST', '/api/login', { username, password })
    if (res.status === 401) throw new UnauthorizedError('Invalid username or password')
    if (res.status === 429) throw new RateLimitedError()
    if (!res.ok) throw await errorFrom(res)
    return (await res.json()) as AuthUser
  }

  async logout(): Promise<void> {
    const res = await this.request('POST', '/api/logout')
    if (!res.ok) throw await errorFrom(res)
  }

  async me(): Promise<AuthUser | null> {
    const res = await this.request('GET', '/api/me')
    if (res.status === 401) return null
    if (!res.ok) throw await errorFrom(res)
    return (await res.json()) as AuthUser
  }
}
