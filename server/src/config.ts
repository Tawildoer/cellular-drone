/** Server settings, all from the environment (.env.example lists them). */
export interface Config {
  host: string
  port: number
  /** SQLite file; ':memory:' for tests. */
  dbPath: string
  /** Created (with role admin) on first start if no user has that name. */
  adminUsername: string | undefined
  adminPassword: string | undefined
  /** Marks the session cookie Secure. Off only for plain-http development
   * away from localhost; browsers already treat http://localhost as secure. */
  cookieSecure: boolean
  sessionTtlMs: number
  /** Origins allowed to make state-changing requests and open signalling with
   * a session cookie (e.g. https://fly.example.com). Empty = same host only. */
  allowedOrigins: string[]
  /** Behind Caddy: take the client address from X-Forwarded-For. */
  trustProxy: boolean
}

const HOUR_MS = 60 * 60 * 1000

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback
  return value === 'true' || value === '1'
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 8788),
    dbPath: env.DB_PATH ?? 'data/server.db',
    adminUsername: env.ADMIN_USERNAME || undefined,
    adminPassword: env.ADMIN_PASSWORD || undefined,
    cookieSecure: bool(env.COOKIE_SECURE, true),
    sessionTtlMs: Number(env.SESSION_TTL_HOURS ?? 12) * HOUR_MS,
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    trustProxy: bool(env.TRUST_PROXY, false),
  }
}
