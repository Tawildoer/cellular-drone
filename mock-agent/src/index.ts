import { WebSocketServer, type WebSocket } from 'ws'
import { DroneEngine } from '../../web/src/link/mock/droneEngine.ts'
import { createMessage, decodeMessage, encodeMessage } from '../../web/src/protocol/index.ts'
import type { HomePosition } from '../../web/src/domain/index.ts'

const PORT = Number(process.env.PORT ?? 8787)
const VEHICLE_ID = process.env.VEHICLE_ID ?? 'drone-1'
const TICK_MS = Number(process.env.TICK_MS ?? 100)
const TIME_SCALE = Number(process.env.TIME_SCALE ?? 1)

const home: HomePosition = {
  lat: Number(process.env.HOME_LAT ?? -37.861),
  lon: Number(process.env.HOME_LON ?? 145.062),
  altAmslM: Number(process.env.HOME_ALT ?? 0),
}

// Runs the same DroneEngine that MockLink uses in-browser (link/mock/droneEngine.ts,
// extracted in ADR-0012 so both stay identical). The engine is created and
// ticking the moment this process starts — not gated on a browser being
// connected — so the simulated flight keeps going whether or not a tab is open,
// the same way a real drone would.
const engine = new DroneEngine({ home })
engine.connect(VEHICLE_ID)

const clients = new Set<WebSocket>()

function broadcast(raw: string): void {
  for (const client of clients) {
    if (client.readyState === client.OPEN) client.send(raw)
  }
}

const wss = new WebSocketServer({ port: PORT })

wss.on('connection', (ws) => {
  clients.add(ws)
  console.log(`[mock-agent] client connected (${clients.size} total)`)

  // Give a (re)connecting browser the current state immediately, rather than
  // waiting for the next tick.
  ws.send(encodeMessage(createMessage('telemetry.state', engine.buildVehicleState())))

  ws.on('message', (data) => {
    const message = decodeMessage(data.toString())
    if (!message) return

    switch (message.type) {
      case 'cmd.request': {
        const result = engine.applyCommand(message.payload)
        ws.send(encodeMessage(createMessage('cmd.result', result, { id: message.id })))
        break
      }
      case 'mission.upload': {
        const { onVehicle, ...result } = engine.uploadMission(message.payload)
        ws.send(
          encodeMessage(
            createMessage('mission.uploaded', { missionId: message.payload.id, result, onVehicle }, { id: message.id }),
          ),
        )
        break
      }
      case 'mission.download': {
        ws.send(encodeMessage(createMessage('mission.current', engine.downloadMission(), { id: message.id })))
        break
      }
      case 'ping': {
        ws.send(encodeMessage(createMessage('pong', {}, { id: message.id })))
        break
      }
      default:
        break
    }
  })

  ws.on('close', () => {
    clients.delete(ws)
    console.log(`[mock-agent] client disconnected (${clients.size} total)`)
  })
})

setInterval(() => {
  const dtS = (TICK_MS / 1000) * TIME_SCALE
  for (const event of engine.tick(dtS)) {
    broadcast(encodeMessage(createMessage('telemetry.event', event)))
  }
  broadcast(encodeMessage(createMessage('telemetry.state', engine.buildVehicleState())))
}, TICK_MS)

console.log(`[mock-agent] listening on ws://localhost:${PORT} — vehicleId=${VEHICLE_ID} home=${home.lat},${home.lon}`)
