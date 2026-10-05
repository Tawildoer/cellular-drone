export interface AuthUser {
  username: string
}

/** Thrown by any AuthClient implementation on bad credentials or an expired
 * session, so the UI can handle a 401 the same way regardless of backend. */
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export interface AuthClient {
  login(username: string, password: string): Promise<AuthUser>
  logout(): Promise<void>
  /** The current session's user, or null if not logged in. */
  me(): Promise<AuthUser | null>
}
