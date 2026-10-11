export interface AuthUser {
  username: string
  /** From the server; the dev mock leaves it out. */
  role?: 'admin' | 'operator'
}

/** Thrown by any AuthClient implementation on bad credentials or an expired
 * session, so the UI can handle a 401 the same way regardless of backend. */
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

/** Thrown when the backend refuses to check credentials for a while after
 * too many failures. The message says so in words the UI can show. */
export class RateLimitedError extends Error {
  constructor(message = 'Too many failed logins, try again later') {
    super(message)
    this.name = 'RateLimitedError'
  }
}

export interface AuthClient {
  login(username: string, password: string): Promise<AuthUser>
  logout(): Promise<void>
  /** The current session's user, or null if not logged in. */
  me(): Promise<AuthUser | null>
}
