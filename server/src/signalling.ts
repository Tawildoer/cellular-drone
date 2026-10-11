import { randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { decodeSignalling, encodeSignalling, type SignallingMessage } from '@cellular-drone/protocol'
import type { FastifyInstance } from 'fastify'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Auth } from './auth.ts'
import type { Config } from './config.ts'
import type { Db } from './db.ts'
import { droneKey } from './drones.ts'
import { mintSessionToken, verifyVehicleSignature, type SigningKey } from './keys.ts'
import type { User } from './users.ts'

/** Pings keep idle connections alive through NATs, tunnels and proxies, and
 * reveal half-dead sockets (e.g. a modem that dropped without a FIN). */
const KEEPALIVE_MS = 20_000
/** A socket that hasn't finished saying who it is by then is dropped. */
const HANDSHAKE_TIMEOUT_MS = 10_000

/** WebSocket close codes the browser and the agent can tell apart. */
export const CLOSE_UNAUTHORIZED = 4401
export const CLOSE_REPLACED = 4000

interface Operator {
  ws: WebSocket
  vehicleId: string
  sessionId: string
  user: User
}

/** Where a socket is in saying who it is. */
type Peer =
  | { state: 'new' }
  | { state: 'challenged'; vehicleId: string; nonce: string }
  | { state: 'vehicle'; vehicleId: string }
  | { state: 'operator'; operator: Operator }

/**
 * The signalling relay at /signal (ARCHITECTURE.md, session flow; ADR-0030):
 * drones hold a WebSocket open, browsers open one per vehicle, and the server
 * passes offers, answers and ICE candidates between them.
 *
 * - A drone proves its key first: hello → challenge (a random nonce) → auth
 *   (its Ed25519 signature over it, checked against the registry) → welcome,
 *   which carries the server's clock.
 * - An operator must be signed in: the session cookie is checked when the
 *   socket opens. Each offer it sends goes to the drone with a fresh session
 *   token signed by the server, naming the user, vehicle and session.
 */
export function registerSignalling(app: FastifyInstance, auth: Auth, db: Db, signingKey: SigningKey, config: Config): void {
  const log = app.log.child({ component: 'signalling' })
  const vehicles = new Map<string, WebSocket>()
  const operators = new Map<string, Operator>()
  const wss = new WebSocketServer({ noServer: true })
  const alive = new WeakMap<WebSocket, boolean>()
  const userOf = new WeakMap<WebSocket, User | null>()
  /** Who each session id was issued to, kept a day past its socket. */
  const sessionOwners = new Map<string, { userId: number; at: number }>()

  app.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    if (path !== '/signal') return reject(socket, 404)
    if (!auth.originAllowed(req.headers.origin, req.headers.host)) {
      log.warn({ origin: req.headers.origin }, 'signalling_origin_refused')
      return reject(socket, 403)
    }
    const user = auth.userFromCookieHeader(req.headers.cookie)
    wss.handleUpgrade(req, socket, head, (ws) => {
      userOf.set(ws, user)
      wss.emit('connection', ws, req)
    })
  })

  const operatorsOf = (vehicleId: string) => [...operators.values()].filter((op) => op.vehicleId === vehicleId)

  function refuse(ws: WebSocket, message: string): void {
    send(ws, { type: 'error', message })
    ws.close(CLOSE_UNAUTHORIZED, message)
  }

  function relayFromOperator(op: Operator, message: SignallingMessage): void {
    const vehicle = vehicles.get(op.vehicleId)
    if (!vehicle) {
      send(op.ws, { type: 'error', message: `vehicle ${op.vehicleId} is offline` })
      return
    }
    switch (message.type) {
      case 'offer': {
        const iat = Math.floor(Date.now() / 1000)
        const sessionToken = mintSessionToken(signingKey.privateKey, {
          sub: op.user.username,
          role: op.user.role,
          vehicleId: op.vehicleId,
          sessionId: op.sessionId,
          iat,
          exp: iat + config.sessionTokenTtlS,
        })
        log.info({ sessionId: op.sessionId, vehicleId: op.vehicleId, username: op.user.username }, 'offer')
        send(vehicle, { type: 'offer', sdp: message.sdp, sessionId: op.sessionId, sessionToken })
        return
      }
      case 'ice':
        send(vehicle, { type: 'ice', candidate: message.candidate, sessionId: op.sessionId })
        return
      default:
        send(op.ws, { type: 'error', message: `unexpected ${message.type} from an operator` })
    }
  }

  function relayFromVehicle(vehicleWs: WebSocket, vehicleId: string, message: SignallingMessage): void {
    if (message.type !== 'answer' && message.type !== 'ice') {
      send(vehicleWs, { type: 'error', message: `unexpected ${message.type} from a vehicle` })
      return
    }
    const op = message.sessionId ? operators.get(message.sessionId) : undefined
    if (!op || op.vehicleId !== vehicleId) {
      log.info({ vehicleId, sessionId: message.sessionId }, 'unknown_session')
      return
    }
    if (message.type === 'answer') {
      log.info({ sessionId: op.sessionId, vehicleId }, 'answer')
      send(op.ws, { type: 'answer', sdp: message.sdp })
    } else {
      send(op.ws, { type: 'ice', candidate: message.candidate })
    }
  }

  function startOperator(ws: WebSocket, vehicleId: string, asked: string | undefined): Operator | null {
    const user = userOf.get(ws)
    if (!user) {
      refuse(ws, 'not signed in')
      return null
    }
    // A session id can be resumed after a signalling reconnect, but only by
    // the user it was issued to, and not while it's live.
    const sessionId =
      asked && !operators.has(asked) && (sessionOwners.get(asked)?.userId ?? user.id) === user.id ? asked : randomUUID()
    const operator = { ws, vehicleId, user, sessionId }
    operators.set(sessionId, operator)
    sessionOwners.set(sessionId, { userId: user.id, at: Date.now() })
    send(ws, { type: 'welcome', sessionId })
    send(ws, { type: 'vehicle.status', vehicleId, online: vehicles.has(vehicleId) })
    return operator
  }

  function welcomeVehicle(ws: WebSocket, vehicleId: string): void {
    // A reconnecting drone (new IP after a modem drop) supersedes its old socket.
    const previous = vehicles.get(vehicleId)
    if (previous && previous !== ws) previous.close(CLOSE_REPLACED, 'replaced by a newer connection')
    vehicles.set(vehicleId, ws)
    send(ws, { type: 'welcome', serverTime: Date.now() })
    for (const op of operatorsOf(vehicleId)) send(op.ws, { type: 'vehicle.status', vehicleId, online: true })
  }

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    let peer: Peer = { state: 'new' }
    const remote = req.socket.remoteAddress
    const handshake = setTimeout(() => {
      if (peer.state === 'new' || peer.state === 'challenged') refuse(ws, 'handshake timed out')
    }, HANDSHAKE_TIMEOUT_MS)

    alive.set(ws, true)
    ws.on('pong', () => alive.set(ws, true))

    ws.on('message', (data) => {
      const message = decodeSignalling(String(data))
      if (!message) {
        send(ws, { type: 'error', message: 'malformed or unknown signalling message (signalling v2?)' })
        return
      }

      switch (peer.state) {
        case 'new': {
          if (message.type !== 'hello') return send(ws, { type: 'error', message: 'send hello first' })
          if (message.role === 'operator') {
            const operator = startOperator(ws, message.vehicleId, message.sessionId)
            if (!operator) return
            peer = { state: 'operator', operator }
            clearTimeout(handshake)
            const { sessionId, user } = operator
            log.info({ role: 'operator', vehicleId: message.vehicleId, sessionId, username: user.username, remote }, 'hello')
          } else {
            const nonce = randomBytes(32).toString('base64url')
            peer = { state: 'challenged', vehicleId: message.vehicleId, nonce }
            send(ws, { type: 'challenge', nonce })
          }
          return
        }
        case 'challenged': {
          if (message.type !== 'auth') return refuse(ws, 'expected auth')
          const key = droneKey(db, peer.vehicleId)
          if (!key || !verifyVehicleSignature(key, peer.vehicleId, peer.nonce, message.signature)) {
            log.warn({ vehicleId: peer.vehicleId, remote, registered: Boolean(key) }, 'vehicle_auth_failed')
            return refuse(ws, key ? 'vehicle signature invalid' : `vehicle ${peer.vehicleId} is not registered`)
          }
          clearTimeout(handshake)
          peer = { state: 'vehicle', vehicleId: peer.vehicleId }
          welcomeVehicle(ws, peer.vehicleId)
          log.info({ role: 'vehicle', vehicleId: peer.vehicleId, remote }, 'hello')
          return
        }
        case 'vehicle':
          return relayFromVehicle(ws, peer.vehicleId, message)
        case 'operator':
          return relayFromOperator(peer.operator, message)
      }
    })

    ws.on('close', (code) => {
      clearTimeout(handshake)
      if (peer.state === 'vehicle' && vehicles.get(peer.vehicleId) === ws) {
        const { vehicleId } = peer
        vehicles.delete(vehicleId)
        for (const op of operatorsOf(vehicleId)) send(op.ws, { type: 'vehicle.status', vehicleId, online: false })
      }
      // An operator's peer connection outlives its signalling socket, so the
      // drone isn't told anything here: the connection itself ends the session.
      if (peer.state === 'operator') operators.delete(peer.operator.sessionId)
      log.info({ state: peer.state, code }, 'closed')
    })
  })

  const keepalive = setInterval(() => {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    for (const [id, owner] of sessionOwners) if (owner.at < dayAgo && !operators.has(id)) sessionOwners.delete(id)
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate()
        continue
      }
      alive.set(ws, false)
      ws.ping()
    }
  }, KEEPALIVE_MS)

  app.addHook('onClose', async () => {
    clearInterval(keepalive)
    for (const ws of wss.clients) ws.terminate()
    wss.close()
  })
}

function send(ws: WebSocket, message: Parameters<typeof encodeSignalling>[0]): void {
  if (ws.readyState === ws.OPEN) ws.send(encodeSignalling(message))
}

function reject(socket: Duplex, status: 403 | 404): void {
  socket.end(`HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Not Found'}\r\nConnection: close\r\n\r\n`)
}
