import { describe, expect, it } from 'vitest'
import type { Command, CommandResult, Mission, VehicleEvent } from '../../domain'
import { decodeMessage, encodeMessage } from '../codec'
import { createMessage, messageSchema, type Message } from '../messages'

const vehicleState: Message['payload'] = {
  vehicleId: 'drone-1',
  position: { lat: 51.5, lon: -0.1, altRelM: 50, altAmslM: 100 },
  attitude: { rollDeg: 0, pitchDeg: 0, yawDeg: 90 },
  groundSpeedMps: 12,
  airspeedMps: 11,
  climbMps: 0,
  battery: { voltageV: 22.1, currentA: 4, percent: 80 },
  gps: { fixType: 'fix3d', satellites: 11, hdop: 0.9 },
  flightMode: 'AUTO',
  armed: true,
  vtolState: 'fw',
  landed: false,
  home: { lat: 51.5, lon: -0.1, altAmslM: 50 },
  missionProgress: { currentIndex: 1, total: 4 },
  rc: { linked: true, overrideActive: false },
  failsafe: { gcs: false, battery: false, geofence: false, rc: false },
  updatedAt: 1_700_000_000_000,
}

const vehicleEvent: VehicleEvent = { kind: 'modeChanged', mode: 'RTL', ts: 1_700_000_000_000 }

const command: Command = { type: 'video.config', preset: 'high' }

const commandResult: CommandResult = { ok: false, reason: 'blocked_rc_override', detail: 'RC override active' }

const mission: Mission = {
  id: 'm1',
  name: 'survey',
  items: [
    { type: 'vtolTakeoff', altM: 50 },
    { type: 'waypoint', lat: 1, lon: 2, altM: 50, acceptRadiusM: 5 },
    { type: 'vtolLand', lat: 1, lon: 2 },
  ],
  createdAt: 1,
  updatedAt: 2,
}

describe('message round-trips', () => {
  it.each([
    ['telemetry.state', vehicleState] as const,
    ['telemetry.event', vehicleEvent] as const,
    ['cmd.request', command] as const,
    ['cmd.result', commandResult] as const,
    ['mission.upload', mission] as const,
    ['mission.uploaded', { missionId: 'm1', result: { ok: true } }] as const,
    ['mission.download', {}] as const,
    ['mission.current', mission] as const,
    ['mission.current', null] as const,
    ['video.config', { preset: 'medium' }] as const,
    ['ping', {}] as const,
    ['pong', {}] as const,
  ])('round-trips %s', (type, payload) => {
    const message = createMessage(type, payload as never, { id: 'req-1' })
    const encoded = encodeMessage(message)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(message)
    expect(decoded?.type).toBe(type)
  })

  it('defaults ts to now when not given', () => {
    const before = Date.now()
    const message = createMessage('ping', {})
    expect(message.ts).toBeGreaterThanOrEqual(before)
  })
})

describe('decodeMessage', () => {
  it('returns null for malformed JSON', () => {
    expect(decodeMessage('{not json')).toBeNull()
  })

  it('returns null for an unknown message type (forward compatibility)', () => {
    const raw = JSON.stringify({ v: 1, type: 'telemetry.future-thing', ts: Date.now(), payload: {} })
    expect(decodeMessage(raw)).toBeNull()
  })

  it('returns null for the wrong protocol version', () => {
    const raw = JSON.stringify({ v: 2, type: 'ping', ts: Date.now(), payload: {} })
    expect(decodeMessage(raw)).toBeNull()
  })

  it('returns null when the payload fails validation', () => {
    const raw = JSON.stringify({ v: 1, type: 'cmd.request', ts: Date.now(), payload: { type: 'warp-drive' } })
    expect(decodeMessage(raw)).toBeNull()
  })
})

describe('messageSchema', () => {
  it('accepts every message produced by createMessage', () => {
    const message = createMessage('telemetry.state', vehicleState)
    expect(messageSchema.safeParse(message).success).toBe(true)
  })
})
