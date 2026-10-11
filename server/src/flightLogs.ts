import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { FLIGHT_LOG_NAME, LOG_UPLOAD_WINDOW_MS, logUploadMessage } from '@cellular-drone/protocol'
import type { FastifyInstance } from 'fastify'
import { requireUser } from './auth.ts'
import type { Config } from './config.ts'
import type { Db } from './db.ts'
import { droneKey } from './drones.ts'
import { verifySignature } from './keys.ts'

/** A flight log can be long: a state sample a second for an hour's flight. */
const MAX_LOG_BYTES = 64 * 1024 * 1024

interface FlightLogRow {
  name: string
  sha256: string
  bytes: number
  uploadedAt: number
}

/**
 * Flight logs (ADR-0030): each drone uploads its finished logs, signed with
 * its own key; signed-in users can list and download them. A log is stored
 * once per vehicle and name: the same file again is fine (a retry), a
 * different file under the same name is refused.
 */
export function registerFlightLogs(app: FastifyInstance, db: Db, config: Config): void {
  const find = db.prepare('SELECT name, sha256, bytes, uploaded_at AS uploadedAt FROM flight_logs WHERE vehicle_id = ? AND name = ?')
  const list = db.prepare('SELECT name, sha256, bytes, uploaded_at AS uploadedAt FROM flight_logs WHERE vehicle_id = ? ORDER BY name DESC')
  const insert = db.prepare('INSERT INTO flight_logs (vehicle_id, name, sha256, bytes, uploaded_at) VALUES (?, ?, ?, ?, ?)')
  const fileOf = (vehicleId: string, name: string) => path.join(config.flightLogDir, vehicleId, name)

  app.register(async (scoped) => {
    // The body is the file itself; Fastify only parses JSON by default.
    scoped.addContentTypeParser('application/x-ndjson', { parseAs: 'buffer', bodyLimit: MAX_LOG_BYTES }, (_req, body, done) =>
      done(null, body),
    )

    scoped.post<{ Params: { id: string; name: string }; Body: Buffer }>(
      '/api/vehicles/:id/logs/:name',
      { bodyLimit: MAX_LOG_BYTES },
      async (req, reply) => {
        const { id, name } = req.params
        if (!FLIGHT_LOG_NAME.test(name)) return reply.code(400).send({ error: 'not a flight log name' })
        if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ error: 'send the log as application/x-ndjson' })

        const timestamp = Number(req.headers['x-drone-timestamp'])
        const signature = req.headers['x-drone-signature']
        const key = droneKey(db, id)
        if (!key || typeof signature !== 'string' || !Number.isFinite(timestamp)) {
          return reply.code(401).send({ error: 'unknown vehicle or unsigned upload' })
        }
        if (Math.abs(Date.now() - timestamp) > LOG_UPLOAD_WINDOW_MS) {
          return reply.code(401).send({ error: 'upload timestamp too far from the server clock' })
        }
        const sha256 = createHash('sha256').update(req.body).digest('hex')
        if (!verifySignature(key, logUploadMessage(id, name, timestamp, sha256), signature)) {
          req.log.warn({ vehicleId: id, name }, 'flight_log_signature_invalid')
          return reply.code(401).send({ error: 'upload signature invalid' })
        }

        const existing = find.get(id, name) as FlightLogRow | undefined
        if (existing) {
          if (existing.sha256 === sha256) return reply.code(200).send({ stored: false, name })
          return reply.code(409).send({ error: 'a different log with that name is already stored' })
        }
        const file = fileOf(id, name)
        mkdirSync(path.dirname(file), { recursive: true })
        // Write then rename, so a crash never leaves half a log under its name.
        writeFileSync(`${file}.partial`, req.body, { mode: 0o640 })
        renameSync(`${file}.partial`, file)
        insert.run(id, name, sha256, req.body.length, Date.now())
        req.log.info({ vehicleId: id, name, bytes: req.body.length }, 'flight_log_stored')
        return reply.code(201).send({ stored: true, name })
      },
    )
  })

  app.register(async (scoped) => {
    scoped.addHook('preHandler', requireUser)

    scoped.get<{ Params: { id: string } }>('/api/vehicles/:id/logs', async (req) => list.all(req.params.id))

    scoped.get<{ Params: { id: string; name: string } }>('/api/vehicles/:id/logs/:name', async (req, reply) => {
      const { id, name } = req.params
      if (!FLIGHT_LOG_NAME.test(name) || !find.get(id, name)) return reply.code(404).send({ error: 'no such log' })
      return reply
        .type('application/x-ndjson')
        .header('content-disposition', `attachment; filename="${id}-${name}"`)
        .send(readFileSync(fileOf(id, name)))
    })
  })
}
