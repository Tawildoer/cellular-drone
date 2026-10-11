import cookie from '@fastify/cookie'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerAuth } from './auth.ts'
import type { Config } from './config.ts'
import type { Db } from './db.ts'
import { loadOrCreateSigningKey, type SigningKey } from './keys.ts'
import { registerMissions } from './missions.ts'
import { registerSignalling } from './signalling.ts'

/** The whole server on one Fastify instance: HTTP API under /api, the
 * signalling WebSocket at /signal. Tests build it on an in-memory database. */
export async function buildApp(
  config: Config,
  db: Db,
  opts: { logger?: boolean; signingKey?: SigningKey } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? true,
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  })
  await app.register(cookie)

  app.get('/healthz', async (_req, reply) => reply.type('text/plain').send('ok'))
  const auth = registerAuth(app, db, config)
  registerMissions(app, db)
  registerSignalling(app, auth, db, opts.signingKey ?? loadOrCreateSigningKey(config.signingKeyFile), config)
  return app
}
