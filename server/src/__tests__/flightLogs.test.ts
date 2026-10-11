import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { logUploadMessage } from '@cellular-drone/protocol'
import { addDrone } from '../drones.ts'
import { parsePublicKey, rawPublicKey, verifySignature } from '../keys.ts'
import { login, testServer, type TestServer } from './helpers.ts'

const vectors = JSON.parse(readFileSync(new URL('../../../testdata/auth/vectors.json', import.meta.url), 'utf8'))
const NAME = 'flight-20261011T030000Z.jsonl'
const BODY = '{"kind":"agent","what":"started"}\n{"kind":"state"}\n'

describe('flight log upload', () => {
  let server: TestServer
  let droneKey: KeyObject
  beforeEach(async () => {
    server = await testServer({ flightLogDir: mkdtempSync(path.join(tmpdir(), 'cd-logs-')) })
    const pair = generateKeyPairSync('ed25519')
    droneKey = pair.privateKey
    addDrone(server.db, 'drone-1', rawPublicKey(pair.publicKey))
  })
  afterEach(async () => {
    await server.app.close()
    server.db.close()
  })

  function upload(body = BODY, opts: { name?: string; key?: KeyObject; timestamp?: number; vehicleId?: string } = {}) {
    const name = opts.name ?? NAME
    const vehicleId = opts.vehicleId ?? 'drone-1'
    const timestamp = opts.timestamp ?? Date.now()
    const sha = createHash('sha256').update(body).digest('hex')
    const signature = sign(null, Buffer.from(logUploadMessage(vehicleId, name, timestamp, sha)), opts.key ?? droneKey).toString('base64url')
    return server.app.inject({
      method: 'POST',
      url: `/api/vehicles/${vehicleId}/logs/${name}`,
      headers: { 'content-type': 'application/x-ndjson', 'x-drone-timestamp': String(timestamp), 'x-drone-signature': signature },
      payload: body,
    })
  }

  it("checks the agent's known-answer signature", () => {
    const { vehicleId, name, timestampMs, body, bodySha256Hex, signature } = vectors.logUpload
    assert.equal(createHash('sha256').update(body).digest('hex'), bodySha256Hex)
    const key = parsePublicKey(vectors.vehicleAuth.dronePublicKey)
    assert.equal(verifySignature(key, logUploadMessage(vehicleId, name, timestampMs, bodySha256Hex), signature), true)
  })

  it('stores a signed log, which a signed-in user can list and download', async () => {
    const res = await upload()
    assert.equal(res.statusCode, 201)
    assert.equal(readFileSync(path.join(server.config.flightLogDir, 'drone-1', NAME), 'utf8'), BODY)

    const cookie = await login(server.app)
    const listed = await server.app.inject({ url: '/api/vehicles/drone-1/logs', headers: { cookie } })
    assert.equal(listed.json()[0].name, NAME)
    assert.equal(listed.json()[0].bytes, Buffer.byteLength(BODY))
    const got = await server.app.inject({ url: `/api/vehicles/drone-1/logs/${NAME}`, headers: { cookie } })
    assert.equal(got.body, BODY)
    assert.equal((await server.app.inject({ url: '/api/vehicles/drone-1/logs' })).statusCode, 401)
  })

  it('takes the same log again as a retry, and refuses a different one under its name', async () => {
    assert.equal((await upload()).statusCode, 201)
    assert.equal((await upload()).statusCode, 200)
    assert.equal((await upload(`${BODY}{"kind":"extra"}\n`)).statusCode, 409)
  })

  it('refuses an unsigned, wrongly signed, stale or unregistered upload', async () => {
    const unsigned = await server.app.inject({
      method: 'POST',
      url: `/api/vehicles/drone-1/logs/${NAME}`,
      headers: { 'content-type': 'application/x-ndjson' },
      payload: BODY,
    })
    assert.equal(unsigned.statusCode, 401)
    assert.equal((await upload(BODY, { key: generateKeyPairSync('ed25519').privateKey })).statusCode, 401)
    assert.equal((await upload(BODY, { timestamp: Date.now() - 10 * 60 * 1000 })).statusCode, 401)
    assert.equal((await upload(BODY, { vehicleId: 'drone-9' })).statusCode, 401)
  })

  it('refuses a name that is not a flight log', async () => {
    assert.equal((await upload(BODY, { name: 'notes.txt' })).statusCode, 400)
  })
})
