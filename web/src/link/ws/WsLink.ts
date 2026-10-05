import type { Command, CommandResult, LinkStatus, Mission, VehicleEvent, VehicleState } from '../../domain'
import { createMessage, decodeMessage, encodeMessage, type Message } from '../../protocol'
import type { Unsubscribe, VehicleLink } from '../VehicleLink'

export interface WsLinkOptions {
  url?: string
}

const DEFAULT_URL = 'ws://localhost:8787'
const REQUEST_TIMEOUT_MS = 3000

function randomId(): string {
  return Math.random().toString(36).slice(2)
}

/**
 * Talks to mock-agent (a standalone Node process, ADR-0012) over a plain
 * WebSocket, carrying the same protocol/ messages MockLink round-trips
 * in-process. From the UI's point of view this is indistinguishable from any
 * other VehicleLink — the whole point of ADR-0009. No video over this
 * transport (mock-agent has no canvas); getVideoStream() is always null.
 */
export class WsLink implements VehicleLink {
  private readonly url: string
  private ws: WebSocket | null = null
  private readonly pending = new Map<string, (message: Message) => void>()

  private readonly stateListeners = new Set<(s: VehicleState) => void>()
  private readonly statusListeners = new Set<(s: LinkStatus) => void>()
  private readonly eventListeners = new Set<(e: VehicleEvent) => void>()
  private readonly videoListeners = new Set<(s: MediaStream | null) => void>()

  constructor(opts: WsLinkOptions = {}) {
    this.url = opts.url ?? DEFAULT_URL
  }

  async connect(_vehicleId: string): Promise<void> {
    this.setStatus({ state: 'connecting' })

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url)
      this.ws = ws

      ws.onopen = () => {
        this.setStatus({ state: 'connected', path: 'direct', lastTelemetryAt: Date.now() })
        resolve()
      }
      ws.onerror = () => reject(new Error(`WsLink: failed to connect to ${this.url}`))
      ws.onclose = () => this.setStatus({ state: 'disconnected' })
      ws.onmessage = (ev) => this.handleMessage(String(ev.data))
    })
  }

  async disconnect(): Promise<void> {
    this.ws?.close()
    this.ws = null
    this.setStatus({ state: 'disconnected' })
  }

  onState(cb: (s: VehicleState) => void): Unsubscribe {
    this.stateListeners.add(cb)
    return () => this.stateListeners.delete(cb)
  }

  onLinkStatus(cb: (s: LinkStatus) => void): Unsubscribe {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  onEvent(cb: (e: VehicleEvent) => void): Unsubscribe {
    this.eventListeners.add(cb)
    return () => this.eventListeners.delete(cb)
  }

  onVideoStream(cb: (s: MediaStream | null) => void): Unsubscribe {
    this.videoListeners.add(cb)
    return () => this.videoListeners.delete(cb)
  }

  getVideoStream(): MediaStream | null {
    return null
  }

  async send(cmd: Command): Promise<CommandResult> {
    if (!this.isOpen()) return { ok: false, reason: 'not_connected' }

    const reply = await this.request(createMessage('cmd.request', cmd, { id: randomId() }))
    return reply && reply.type === 'cmd.result' ? reply.payload : { ok: false, reason: 'timeout' }
  }

  async uploadMission(mission: Mission): Promise<CommandResult> {
    if (!this.isOpen()) return { ok: false, reason: 'not_connected' }

    const reply = await this.request(createMessage('mission.upload', mission, { id: randomId() }))
    return reply && reply.type === 'mission.uploaded' ? reply.payload.result : { ok: false, reason: 'timeout' }
  }

  async downloadMission(): Promise<Mission | null> {
    if (!this.isOpen()) return null

    const reply = await this.request(createMessage('mission.download', {}, { id: randomId() }))
    return reply && reply.type === 'mission.current' ? reply.payload : null
  }

  // --- internals -----------------------------------------------------

  private isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  private request(message: Message): Promise<Message | null> {
    const id = message.id
    if (!id || !this.ws) return Promise.resolve(null)
    const ws = this.ws

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(null)
      }, REQUEST_TIMEOUT_MS)

      this.pending.set(id, (reply) => {
        clearTimeout(timer)
        resolve(reply)
      })
      ws.send(encodeMessage(message))
    })
  }

  private handleMessage(raw: string): void {
    const message = decodeMessage(raw)
    if (!message) return

    if (message.id) {
      const resolve = this.pending.get(message.id)
      if (resolve) {
        this.pending.delete(message.id)
        resolve(message)
        return
      }
    }

    if (message.type === 'telemetry.state') {
      for (const cb of this.stateListeners) cb(message.payload)
    } else if (message.type === 'telemetry.event') {
      for (const cb of this.eventListeners) cb(message.payload)
    }
  }

  private setStatus(status: LinkStatus): void {
    for (const cb of this.statusListeners) cb(status)
  }
}
