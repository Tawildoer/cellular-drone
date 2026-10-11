import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { decodeSignalling, encodeSignalling, type SignallingMessage } from '@cellular-drone/protocol'
import WebSocket from 'ws'
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

  beforeEach(async () => {
    server = await testServer()
    await server.app.listen({ host: '127.0.0.1', port: 0 })
    url = `ws://127.0.0.1:${(server.app.server.address() as AddressInfo).port}/signal`
    cookie = await login(server.app)
  })
  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.terminate()
    await server.app.close()
    server.db.close()
  })

  it('turns away an operator who is not signed in', async () => {
    const op = client()
    await op.opened()
    op.send({ type: 'hello', role: 'operator', vehicleId: 'drone-1' })
    assert.deepEqual(await op.next(), { v: 1, type: 'error', message: 'not signed in' })
    const [code] = await once(op.ws, 'close')
    assert.equal(code, CLOSE_UNAUTHORIZED)
  })

  it('refuses the upgrade from another site', async () => {
    const op = client({ cookie, origin: 'https://evil.example' })
    const [err] = await once(op.ws, 'error')
    assert.match(String(err), /403/)
  })

  it('relays an offer from a signed-in operator to the drone, and the answer back', async () => {
    const drone = client()
    await drone.opened()
    drone.send({ type: 'hello', role: 'vehicle', vehicleId: 'drone-1' })
    assert.equal((await drone.next()).type, 'welcome')

    const op = client({ cookie })
    await op.opened()
    op.send({ type: 'hello', role: 'operator', vehicleId: 'drone-1' })
    const welcome = await op.next()
    assert.equal(welcome.type, 'welcome')
    const sessionId = welcome.type === 'welcome' ? welcome.sessionId : undefined
    assert.ok(sessionId)
    assert.deepEqual(await op.next(), { v: 1, type: 'vehicle.status', vehicleId: 'drone-1', online: true })

    op.send({ type: 'offer', sdp: 'v=0 offer' })
    const offer = await drone.next()
    assert.equal(offer.type, 'offer')
    assert.equal(offer.type === 'offer' && offer.sessionId, sessionId)
    assert.ok(offer.type === 'offer' && offer.sessionToken)

    drone.send({ type: 'answer', sdp: 'v=0 answer', sessionId })
    assert.deepEqual(await op.next(), { v: 1, type: 'answer', sdp: 'v=0 answer' })
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
