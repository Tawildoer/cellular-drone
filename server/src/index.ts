import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { decodeSignalling, encodeSignalling, type SignallingMessage } from '../../web/src/protocol/signalling.ts'

const PORT = Number(process.env.PORT ?? 8788)
const HOST = process.env.HOST ?? '0.0.0.0'
/** Placeholder until auth exists: the drone's verification hook accepts it.
 * Replaced by an Ed25519-signed token when server auth lands (PLAN 1c). */
const DEV_SESSION_TOKEN = 'unsigned-dev'
/** Pings keep idle connections alive through NATs, tunnels and proxies, and
 * reveal half-dead sockets (e.g. a modem that dropped without a FIN). */
const KEEPALIVE_MS = 20_000

interface Operator {
  ws: WebSocket
  vehicleId: string
  sessionId: string
}

const vehicles = new Map<string, WebSocket>()
const operators = new Map<string, Operator>()

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }))
}

function send(ws: WebSocket, message: Parameters<typeof encodeSignalling>[0]): void {
  if (ws.readyState === ws.OPEN) ws.send(encodeSignalling(message))
}

function operatorsOf(vehicleId: string): Operator[] {
  return [...operators.values()].filter((op) => op.vehicleId === vehicleId)
}

function relayFromOperator(op: Operator, message: SignallingMessage): void {
  const vehicle = vehicles.get(op.vehicleId)
  if (!vehicle) {
    send(op.ws, { type: 'error', message: `vehicle ${op.vehicleId} is offline` })
    return
  }
  switch (message.type) {
    case 'offer':
      log('offer', { sessionId: op.sessionId, vehicleId: op.vehicleId })
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
    log('unknown_session', { vehicleId, sessionId: message.sessionId })
    return
  }
  if (message.type === 'answer') {
    log('answer', { sessionId: op.sessionId, vehicleId })
    send(op.ws, { type: 'answer', sdp: message.sdp })
  } else {
    send(op.ws, { type: 'ice', candidate: message.candidate })
  }
}

const httpServer = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
    return
  }
  res.writeHead(404).end()
})

const wss = new WebSocketServer({ server: httpServer, path: '/signal' })
const alive = new WeakMap<WebSocket, boolean>()

wss.on('connection', (ws, req) => {
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
      role = message.role
      vehicleId = message.vehicleId
      if (role === 'vehicle') {
        // A reconnecting drone (new IP after a modem drop) supersedes its old socket.
        const previous = vehicles.get(vehicleId)
        if (previous && previous !== ws) previous.close(4000, 'replaced by a newer connection')
        vehicles.set(vehicleId, ws)
        send(ws, { type: 'welcome' })
        for (const op of operatorsOf(vehicleId)) send(op.ws, { type: 'vehicle.status', vehicleId, online: true })
      } else {
        const resumable = message.sessionId && !operators.has(message.sessionId)
        operator = { ws, vehicleId, sessionId: resumable ? message.sessionId! : randomUUID() }
        operators.set(operator.sessionId, operator)
        send(ws, { type: 'welcome', sessionId: operator.sessionId })
        send(ws, { type: 'vehicle.status', vehicleId, online: vehicles.has(vehicleId) })
      }
      log('hello', { role, vehicleId, sessionId: operator?.sessionId, remote })
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
    log('closed', { role, vehicleId, sessionId: operator?.sessionId, code })
  })
})

const keepalive = setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.get(ws)) {
      ws.terminate()
      continue
    }
    alive.set(ws, false)
    ws.ping()
  }
}, KEEPALIVE_MS)
wss.on('close', () => clearInterval(keepalive))

httpServer.listen(PORT, HOST, () => log('listening', { host: HOST, port: PORT, path: '/signal' }))
