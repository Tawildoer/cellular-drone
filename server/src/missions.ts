import { randomUUID } from 'node:crypto'
import { missionSchema, type WireMission as Mission } from '@cellular-drone/protocol'
import type { FastifyInstance } from 'fastify'
import { requireUser } from './auth.ts'
import type { Db } from './db.ts'

/**
 * Missions CRUD, shared by every signed-in user (one fleet). Bodies are
 * checked against the protocol's missionSchema, the same shape the browser
 * uploads to the drone; the server owns id, createdAt and updatedAt. The
 * planner's own checks (domain/validation, the fence) stay in the browser
 * and the agent, which validates again before writing the FC.
 */
export function registerMissions(app: FastifyInstance, db: Db): void {
  const all = db.prepare('SELECT body FROM missions ORDER BY updated_at DESC')
  const one = db.prepare('SELECT body FROM missions WHERE id = ?')
  const insert = db.prepare('INSERT INTO missions (id, body, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
  const update = db.prepare('UPDATE missions SET body = ?, updated_at = ? WHERE id = ?')
  const remove = db.prepare('DELETE FROM missions WHERE id = ?')

  const read = (row: unknown): Mission => JSON.parse((row as { body: string }).body) as Mission
  /** Accepts a mission from the browser, minus the fields the server sets. */
  const incoming = missionSchema.partial({ id: true, createdAt: true, updatedAt: true })

  app.register(async (scoped) => {
    scoped.addHook('preHandler', requireUser)

    scoped.get('/api/missions', async () => all.all().map(read))

    scoped.get<{ Params: { id: string } }>('/api/missions/:id', async (req, reply) => {
      const row = one.get(req.params.id)
      return row ? read(row) : reply.code(404).send({ error: 'no such mission' })
    })

    scoped.post('/api/missions', async (req, reply) => {
      const parsed = incoming.safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: 'invalid mission', issues: parsed.error.issues })
      const now = Date.now()
      const mission: Mission = { ...parsed.data, id: randomUUID(), createdAt: now, updatedAt: now }
      insert.run(mission.id, JSON.stringify(mission), req.user!.id, now, now)
      return reply.code(201).send(mission)
    })

    scoped.put<{ Params: { id: string } }>('/api/missions/:id', async (req, reply) => {
      const existing = one.get(req.params.id)
      if (!existing) return reply.code(404).send({ error: 'no such mission' })
      const parsed = incoming.safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: 'invalid mission', issues: parsed.error.issues })
      const now = Date.now()
      const mission: Mission = { ...parsed.data, id: req.params.id, createdAt: read(existing).createdAt, updatedAt: now }
      update.run(JSON.stringify(mission), now, mission.id)
      return mission
    })

    scoped.delete<{ Params: { id: string } }>('/api/missions/:id', async (req, reply) => {
      remove.run(req.params.id)
      return reply.code(204).send()
    })
  })
}
