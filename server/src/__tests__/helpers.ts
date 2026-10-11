import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.ts'
import { loadConfig, type Config } from '../config.ts'
import { openDb, type Db } from '../db.ts'
import { createUser } from '../users.ts'

export const PASSWORD = 'correct horse battery'

export interface TestServer {
  app: FastifyInstance
  db: Db
  config: Config
}

/** A server on an in-memory database with one operator, `pilot`. */
export async function testServer(overrides: Partial<Config> = {}): Promise<TestServer> {
  const config = { ...loadConfig({}), dbPath: ':memory:', cookieSecure: false, ...overrides }
  const db = openDb(config.dbPath)
  await createUser(db, 'pilot', PASSWORD, 'operator')
  const app = await buildApp(config, db, { logger: false })
  return { app, db, config }
}

/** Logs in and returns the Cookie header value for later requests. */
export async function login(app: FastifyInstance, username = 'pilot', password = PASSWORD): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/login', payload: { username, password } })
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`)
  const cookie = res.cookies[0]
  if (!cookie) throw new Error('no session cookie')
  return `${cookie.name}=${cookie.value}`
}
