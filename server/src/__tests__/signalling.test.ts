import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  SESSION_TOKEN_CONTEXT,
  SIGNALLING_VERSION,
  decodeSignalling,
  encodeSignalling,
  sessionTokenClaimsSchema,
  vehicleAuthMessage,
  type SignallingMessage,
} from '@cellular-drone/protocol'
import WebSocket from 'ws'
import { addDrone } from '../drones.ts'
import { parsePublicKey, rawPublicKey } from '../keys.ts'
import { CLOSE_UNAUTHORIZED } from '../signalling.ts'
import { login, testServer, type TestServer } from './helpers.ts'

/** A client that queues decoded messages so a test can await them in order. */
class Client {
  readonly ws: WebSocket
  private readonly inbox: SignallingMessage[] = []
  private waiting: ((m: SignallingMessage) => void) | null = null

  constructor(url: string, headers: Record<string, string> = {}) {
    this.ws = new WebSocket(url, { headers })
    this.ws.on('message', (data) => {
      const message = decodeSignalling(String(data))
      if (!message) return
      if (this.waiting) {
        const resolve = this.waiting
        this.waiting = null
        resolve(message)
      } else this.inbox.push(message)
    })
  }

  opened() {
    return once(this.ws, 'open')
  }

  send(message: Parameters<typeof encodeSignalling>[0]) {
    this.ws.send(encodeSignalling(message))
  }

  next(): Promise<SignallingMessage> {
    const queued = this.inbox.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve) => (this.waiting = resolve))
  }
}

const v = SIGNALLING_VERSION

describe('signalling', () => {
  let server: TestServer
  let url: string
  let cookie: string
  const clients: Client[] = []
  const client = (headers?: Record<string, string>) => {
    const c = new Client(url, headers)
    clients.push(c)
    return c
  }

  let droneKey: KeyObject
  beforeEach(async () => {
    server = await testServer()
    const pair = generateKeyPairSync('ed25519')
    droneKey = pair.privateKey
    addDrone(server.db, 'drone-1', rawPublicKey(pair.publicKey))
    await server.app.listen({ host: '127.0.0.1', port: 0 })
    url = `ws://127.0.0.1:${(server.app.server.address() as AddressInfo).port}/signal`
    cookie = await login(server.app)
  })
  /** A drone through the whole handshake, signing with `key`. */
  async function connectDrone(vehicleId = 'drone-1', key = droneKey): Promise<Client> {
    const drone = client()
    await drone.opened()
    drone.send({ type: 'hello', role: 'vehicle', vehicleId })
    const challenge = await drone.next()
    assert.equal(challenge.type, 'challenge')
    if (challenge.type !== 'challenge') throw new Error('no challenge')
    const signature = sign(null, Buffer.from(vehicleAuthMessage(vehicleId, challenge.nonce)), key).toString('base64url')
    drone.send({ type: 'auth', signature })
    return drone
  }

  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.terminate()
    await server.app.close()
    server.db.close()
  })

  it('turns away an operator who is not signed in', async () => {
    const op = client()
    await op.opened()
    op.send({ type: 'hello', role: 'operator', vehicleId: 'drone-1' })
    assert.deepEqual(await op.next(), { v, type: 'error', message: 'not signed in' })
    const [code] = await once(op.ws, 'close')
    assert.equal(code, CLOSE_UNAUTHORIZED)
  })

  it('refuses the upgrade from another site', async () => {
    const op = client({ cookie, origin: 'https://evil.example' })
    const [err] = await once(op.ws, 'error')
    assert.match(String(err), /403/)
  })

  it('welcomes a registered drone that signs the challenge, with the server clock', async () => {
    const before = Date.now()
    const drone = await connectDrone()
    const welcome = await drone.next()
    assert.equal(welcome.type, 'welcome')
    const serverTime = welcome.type === 'welcome' ? welcome.serverTime : undefined
    assert.ok(serverTime && serverTime >= before && serverTime <= Date.now())
  })

  it('refuses a drone that is not registered, or signs with the wrong key', async () => {
    const stranger = await connectDrone('drone-9')
    assert.deepEqual(await stranger.next(), { v, type: 'error', message: 'vehicle drone-9 is not registered' })
    assert.equal((await once(stranger.ws, 'close'))[0], CLOSE_UNAUTHORIZED)

    const impostor = await connectDrone('drone-1', generateKeyPairSync('ed25519').privateKey)
    assert.deepEqual(await impostor.next(), { v, type: 'error', message: 'vehicle signature invalid' })
    assert.equal((await once(impostor.ws, 'close'))[0], CLOSE_UNAUTHORIZED)
  })

  it("doesn't relay anything for a drone that hasn't proved its key", async () => {
    const drone = client()
    await drone.opened()
    drone.send({ type: 'hello', role: 'vehicle', vehicleId: 'drone-1' })
    assert.equal((await drone.next()).type, 'challenge')
    drone.send({ type: 'answer', sdp: 'v=0', sessionId: 'x' })
    assert.deepEqual(await drone.next(), { v, type: 'error', message: 'expected auth' })
  })

  it('relays an offer from a signed-in operator to the drone with a signed token, and the answer back', async () => {
    const drone = await connectDrone()
    assert.equal((await drone.next()).type, 'welcome')

    const op = client({ cookie })
    await op.opened()
    op.send({ type: 'hello', role: 'operator', vehicleId: 'drone-1' })
    const welcome = await op.next()
    assert.equal(welcome.type, 'welcome')
    const sessionId = welcome.type === 'welcome' ? welcome.sessionId : undefined
    assert.ok(sessionId)
    assert.deepEqual(await op.next(), { v, type: 'vehicle.status', vehicleId: 'drone-1', online: true })

    op.send({ type: 'offer', sdp: 'v=0 offer' })
    const offer = await drone.next()
    if (offer.type !== 'offer' || !offer.sessionToken) throw new Error('expected an offer with a token')
    assert.equal(offer.sessionId, sessionId)
    const [payload, signature] = offer.sessionToken.split('.')
    assert.ok(
      verify(
        null,
        Buffer.from(SESSION_TOKEN_CONTEXT + payload),
        parsePublicKey(server.signingKey.publicKey),
        Buffer.from(signature!, 'base64url'),
      ),
    )
    const claims = sessionTokenClaimsSchema.parse(JSON.parse(Buffer.from(payload!, 'base64url').toString()))
    assert.equal(claims.sub, 'pilot')
    assert.equal(claims.vehicleId, 'drone-1')
    assert.equal(claims.sessionId, sessionId)
    assert.equal(claims.exp - claims.iat, server.config.sessionTokenTtlS)

    drone.send({ type: 'answer', sdp: 'v=0 answer', sessionId })
    assert.deepEqual(await op.next(), { v, type: 'answer', sdp: 'v=0 answer' })
  })

  it("won't hand one user's session id to another", async () => {
    const op = client({ cookie })
    await op.opened()
    op.send({ type: 'hello', role: 'operator', vehicleId: 'drone-1' })
    const first = await op.next()
    const sessionId = first.type === 'welcome' ? first.sessionId : undefined
    op.ws.close()
    await once(op.ws, 'close')

    const { createUser } = await import('../users.ts')
    await createUser(server.db, 'intruder', 'another password', 'operator')
    const other = client({ cookie: await login(server.app, 'intruder', 'another password') })
    await other.opened()
    other.send({ type: 'hello', role: 'operator', vehicleId: 'drone-1', sessionId })
    const welcome = await other.next()
    assert.equal(welcome.type, 'welcome')
    assert.notEqual(welcome.type === 'welcome' && welcome.sessionId, sessionId)

    // The owner gets it back after a reconnect.
    const again = client({ cookie })
    await again.opened()
    again.send({ type: 'hello', role: 'operator', vehicleId: 'drone-1', sessionId })
    const resumed = await again.next()
    assert.equal(resumed.type === 'welcome' && resumed.sessionId, sessionId)
  })
})
