import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { decodeSignalling, encodeSignalling, type SignallingMessage } from '@cellular-drone/protocol'
import type { FastifyInstance } from 'fastify'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Auth } from './auth.ts'
import type { User } from './users.ts'

/** Placeholder until the server signs session tokens: the drone's
 * verification hook accepts it only with -insecure-dev-tokens. */
const DEV_SESSION_TOKEN = 'unsigned-dev'
/** Pings keep idle connections alive through NATs, tunnels and proxies, and
 * reveal half-dead sockets (e.g. a modem that dropped without a FIN). */
const KEEPALIVE_MS = 20_000

/** WebSocket close codes the browser can tell apart. */
export const CLOSE_UNAUTHORIZED = 4401

interface Operator {
  ws: WebSocket
  vehicleId: string
  sessionId: string
  user: User
}

/**
 * The signalling relay at /signal (ARCHITECTURE.md, session flow): drones
 * hold a WebSocket open, browsers open one per vehicle, and the server
 * passes offers, answers and ICE candidates between them. An operator must
 * be signed in: the session cookie is checked when the socket opens.
 */
export function registerSignalling(app: FastifyInstance, auth: Auth): void {
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

  function relayFromOperator(op: Operator, message: SignallingMessage): void {
    const vehicle = vehicles.get(op.vehicleId)
    if (!vehicle) {
      send(op.ws, { type: 'error', message: `vehicle ${op.vehicleId} is offline` })
      return
    }
    switch (message.type) {
      case 'offer':
        log.info({ sessionId: op.sessionId, vehicleId: op.vehicleId, username: op.user.username }, 'offer')
        send(vehicle, { type: 'offer', sdp: message.sdp, sessionId: op.sessionId, sessionToken: DEV_SESSION_TOKEN })
        return
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

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    let role: 'vehicle' | 'operator' | null = null
    let vehicleId = ''
    let operator: Operator | null = null
    const remote = req.socket.remoteAddress

    alive.set(ws, true)
    ws.on('pong', () => alive.set(ws, true))

    ws.on('message', (data) => {
      const message = decodeSignalling(String(data))
      if (!message) {
        send(ws, { type: 'error', message: 'malformed or unknown signalling message' })
        return
      }

      if (role === null) {
        if (message.type !== 'hello') {
          send(ws, { type: 'error', message: 'send hello first' })
          return
        }
        if (message.role === 'operator') {
          const user = userOf.get(ws)
          if (!user) {
            send(ws, { type: 'error', message: 'not signed in' })
            ws.close(CLOSE_UNAUTHORIZED, 'not signed in')
            return
          }
          role = 'operator'
          vehicleId = message.vehicleId
          // A session id can be resumed after a signalling reconnect, but
          // only by the user it was issued to, and not while it's live.
          const asked = message.sessionId
          const sessionId =
            asked && !operators.has(asked) && (sessionOwners.get(asked)?.userId ?? user.id) === user.id ? asked : randomUUID()
          operator = { ws, vehicleId, user, sessionId }
          operators.set(operator.sessionId, operator)
          sessionOwners.set(operator.sessionId, { userId: user.id, at: Date.now() })
          send(ws, { type: 'welcome', sessionId: operator.sessionId })
          send(ws, { type: 'vehicle.status', vehicleId, online: vehicles.has(vehicleId) })
        } else {
          role = 'vehicle'
          vehicleId = message.vehicleId
          // A reconnecting drone (new IP after a modem drop) supersedes its old socket.
          const previous = vehicles.get(vehicleId)
          if (previous && previous !== ws) previous.close(4000, 'replaced by a newer connection')
          vehicles.set(vehicleId, ws)
          send(ws, { type: 'welcome' })
          for (const op of operatorsOf(vehicleId)) send(op.ws, { type: 'vehicle.status', vehicleId, online: true })
        }
        log.info({ role, vehicleId, sessionId: operator?.sessionId, username: operator?.user.username, remote }, 'hello')
        return
      }

      if (operator) relayFromOperator(operator, message)
      else relayFromVehicle(ws, vehicleId, message)
    })

    ws.on('close', (code) => {
      if (role === 'vehicle' && vehicles.get(vehicleId) === ws) {
        vehicles.delete(vehicleId)
        for (const op of operatorsOf(vehicleId)) send(op.ws, { type: 'vehicle.status', vehicleId, online: false })
      }
      // An operator's peer connection outlives its signalling socket, so the
      // drone isn't told anything here: the connection itself ends the session.
      if (operator) operators.delete(operator.sessionId)
      log.info({ role, vehicleId, sessionId: operator?.sessionId, code }, 'closed')
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
