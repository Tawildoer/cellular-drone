import { createHash, randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Config } from './config.ts'
import type { Db } from './db.ts'
import { dummyPasswordHash, verifyPassword } from './passwords.ts'
import { FailureLimiter } from './rateLimit.ts'
import { findUserForLogin, type User } from './users.ts'

/**
 * Password login and cookie sessions (ARCHITECTURE.md, session flow step 2).
 * The cookie holds 256 random bits; the database keeps only their SHA-256.
 * It is HttpOnly and SameSite=Strict, and Secure in production, where the
 * __Host- prefix also pins it to this exact host.
 */
export interface Auth {
  cookieName: string
  /** The signed-in user for a raw Cookie header, or null. For the
   * signalling upgrade, which doesn't go through Fastify's routing. */
  userFromCookieHeader(header: string | undefined): User | null
  /** Rejects a cross-site request: true if `origin` may act with a cookie. */
  originAllowed(origin: string | undefined, host: string | undefined): boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null
  }
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export function registerAuth(app: FastifyInstance, db: Db, config: Config): Auth {
  const cookieName = config.cookieSecure ? '__Host-session' : 'session'
  const perAccount = new FailureLimiter(5, LOGIN_WINDOW_MS)
  const perAddress = new FailureLimiter(20, LOGIN_WINDOW_MS)

  const findSession = db.prepare(
    `SELECT users.id, users.username, users.role FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
  )
  const insertSession = db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
  const deleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?')
  const deleteExpired = db.prepare('DELETE FROM sessions WHERE expires_at <= ?')

  function userFromToken(token: string | undefined): User | null {
    if (!token) return null
    return (findSession.get(sha256(token), Date.now()) as User | undefined) ?? null
  }

  const auth: Auth = {
    cookieName,
    userFromCookieHeader(header) {
      if (!header) return null
      return userFromToken(app.parseCookie(header)[cookieName])
    },
    originAllowed(origin, host) {
      // Browsers send Origin on every cross-site and every state-changing
      // request; a client without one (curl, the CLI) isn't a browser riding
      // on someone's cookie.
      if (!origin) return true
      if (config.allowedOrigins.includes(origin)) return true
      try {
        return new URL(origin).host === host
      } catch {
        return false
      }
    },
  }

  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !auth.originAllowed(req.headers.origin, req.headers.host)) {
      return reply.code(403).send({ error: 'cross-site request refused' })
    }
    req.user = userFromToken(req.cookies[cookieName])
  })

  const sweep = setInterval(() => deleteExpired.run(Date.now()), 60 * 60 * 1000)
  sweep.unref()
  app.addHook('onClose', async () => clearInterval(sweep))

  function setSessionCookie(reply: FastifyReply, token: string, maxAgeS: number) {
    reply.setCookie(cookieName, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      maxAge: maxAgeS,
    })
  }

  app.post<{ Body: { username?: unknown; password?: unknown } }>('/api/login', async (req, reply) => {
    const { username, password } = req.body ?? {}
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 256) {
      return reply.code(400).send({ error: 'username and password required' })
    }
    const accountKey = username.toLowerCase()
    const wait = Math.max(perAccount.retryAfterMs(accountKey), perAddress.retryAfterMs(req.ip))
    if (wait > 0) {
      reply.header('retry-after', Math.ceil(wait / 1000))
      return reply.code(429).send({ error: 'too many failed logins, try again later' })
    }

    const row = findUserForLogin(db, username)
    const ok = await verifyPassword(password, row?.password_hash ?? (await dummyPasswordHash()))
    if (!row || !ok) {
      perAccount.fail(accountKey)
      perAddress.fail(req.ip)
      req.log.warn({ username, ip: req.ip }, 'login_failed')
      return reply.code(401).send({ error: 'invalid username or password' })
    }
    perAccount.reset(accountKey)

    const token = randomBytes(32).toString('base64url')
    const now = Date.now()
    insertSession.run(sha256(token), row.id, now, now + config.sessionTtlMs)
    setSessionCookie(reply, token, Math.floor(config.sessionTtlMs / 1000))
    req.log.info({ username: row.username }, 'login')
    return { username: row.username, role: row.role }
  })

  app.post('/api/logout', async (req, reply) => {
    const token = req.cookies[cookieName]
    if (token) deleteSession.run(sha256(token))
    reply.clearCookie(cookieName, { path: '/', httpOnly: true, sameSite: 'strict', secure: config.cookieSecure })
    return reply.code(204).send()
  })

  app.get('/api/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'not signed in' })
    return { username: req.user.username, role: req.user.role }
  })

  return auth
}

/** preHandler for routes that need a signed-in user. */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) return reply.code(401).send({ error: 'not signed in' })
}
