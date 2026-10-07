import type { Command, CommandResult, LinkState, LinkStatus, Mission, VehicleEvent, VehicleState } from '../../domain'
import {
  createMessage,
  decodeMessage,
  decodeSignalling,
  encodeMessage,
  encodeSignalling,
  type IceCandidateInit,
  type Message,
  type SignallingMessage,
} from '../../protocol'
import type { Unsubscribe, VehicleLink } from '../VehicleLink'
import { packetLossPct, summariseStats, videoKbps, type LinkSample, type StatsEntry } from './linkStats'

export interface WebRtcLinkOptions {
  signalUrl?: string
  iceServers?: RTCIceServer[]
  /** Force every path through TURN (`iceTransportPolicy: "relay"`) — for testing the relayed path. */
  relayOnly?: boolean
}

const DEFAULT_SIGNAL_URL = 'ws://localhost:8788/signal'
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
const REQUEST_TIMEOUT_MS = 5000
const STATS_INTERVAL_MS = 1000
/** Telemetry older than this marks the link degraded even if ICE says connected. */
const TELEMETRY_STALE_MS = 1500
/** Brief `disconnected` blips often heal on their own; restart ICE only if one lasts. */
const DISCONNECTED_RESTART_MS = 2000
/** A failure within this long of an ICE restart gets a fresh peer connection instead of another restart. */
const FRESH_PEER_AFTER_MS = 30_000
const SIGNAL_RETRY_MIN_MS = 1000
const SIGNAL_RETRY_MAX_MS = 15000

function randomId(): string {
  return Math.random().toString(36).slice(2)
}

/** Protocol messages are JSON text; accept them as binary frames too. */
function frameText(data: unknown): string {
  return data instanceof ArrayBuffer ? new TextDecoder().decode(data) : String(data)
}

/**
 * The real link: WebRTC straight to the drone agent, brokered by the
 * signalling server. The browser is the SDP offerer, so it owns recovery —
 * a connection that goes `disconnected` for long or `failed` gets an ICE
 * restart (a new offer over signalling), which is what survives a modem
 * reconnect or a carrier IP change. Data channels carry the same protocol/
 * messages as MockLink and WsLink: `telemetry` (unordered, no retransmits)
 * and `control` (reliable, ordered). getStats() feeds LinkStatus, so the HUD
 * link badge shows the selected path (direct or relayed) and RTT.
 */
export class WebRtcLink implements VehicleLink {
  private readonly signalUrl: string
  private readonly iceServers: RTCIceServer[]
  private readonly relayOnly: boolean

  private vehicleId = ''
  private sessionId: string | undefined
  private wanted = false
  private signal: WebSocket | null = null
  private signalRetryMs = SIGNAL_RETRY_MIN_MS
  private signalRetryTimer: ReturnType<typeof setTimeout> | null = null

  private pc: RTCPeerConnection | null = null
  private control: RTCDataChannel | null = null
  private pendingCandidates: IceCandidateInit[] = []
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private lastRestartAt: number | null = null
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private lastSample: LinkSample | null = null
  private lastTelemetryAt: number | undefined
  private videoStream: MediaStream | null = null
  private status: LinkStatus = { state: 'disconnected' }

  private readonly pending = new Map<string, (message: Message) => void>()
  private readonly stateListeners = new Set<(s: VehicleState) => void>()
  private readonly statusListeners = new Set<(s: LinkStatus) => void>()
  private readonly eventListeners = new Set<(e: VehicleEvent) => void>()
  private readonly videoListeners = new Set<(s: MediaStream | null) => void>()

  constructor(opts: WebRtcLinkOptions = {}) {
    this.signalUrl = opts.signalUrl ?? DEFAULT_SIGNAL_URL
    this.iceServers = opts.iceServers ?? DEFAULT_ICE_SERVERS
    this.relayOnly = opts.relayOnly ?? false
  }

  async connect(vehicleId: string): Promise<void> {
    this.vehicleId = vehicleId
    this.wanted = true
    this.setStatus({ state: 'connecting' })
    this.openSignalling()
  }

  async disconnect(): Promise<void> {
    this.wanted = false
    if (this.signalRetryTimer) clearTimeout(this.signalRetryTimer)
    this.signalRetryTimer = null
    this.signal?.close()
    this.signal = null
    this.sessionId = undefined
    this.closePeer()
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
    return this.videoStream
  }

  async send(cmd: Command): Promise<CommandResult> {
    const reply = await this.request(createMessage('cmd.request', cmd, { id: randomId() }))
    if (reply === 'not_connected') return { ok: false, reason: 'not_connected' }
    return reply && reply.type === 'cmd.result' ? reply.payload : { ok: false, reason: 'timeout' }
  }

  async uploadMission(mission: Mission): Promise<CommandResult> {
    const reply = await this.request(createMessage('mission.upload', mission, { id: randomId() }))
    if (reply === 'not_connected') return { ok: false, reason: 'not_connected' }
    return reply && reply.type === 'mission.uploaded' ? reply.payload.result : { ok: false, reason: 'timeout' }
  }

  async downloadMission(): Promise<Mission | null> {
    const reply = await this.request(createMessage('mission.download', {}, { id: randomId() }))
    return reply && reply !== 'not_connected' && reply.type === 'mission.current' ? reply.payload : null
  }

  // --- signalling ------------------------------------------------------

  private openSignalling(): void {
    const ws = new WebSocket(this.signalUrl)
    this.signal = ws

    ws.onopen = () => {
      this.signalRetryMs = SIGNAL_RETRY_MIN_MS
      this.sendSignal({ type: 'hello', role: 'operator', vehicleId: this.vehicleId, sessionId: this.sessionId })
    }
    ws.onmessage = (ev) => {
      const message = decodeSignalling(String(ev.data))
      if (message) void this.handleSignal(message)
    }
    ws.onclose = () => {
      if (this.signal !== ws) return
      this.signal = null
      if (!this.wanted) return
      // The peer connection carries on without signalling; this only matters
      // for the next offer or ICE restart.
      this.signalRetryTimer = setTimeout(() => this.openSignalling(), this.signalRetryMs)
      this.signalRetryMs = Math.min(this.signalRetryMs * 2, SIGNAL_RETRY_MAX_MS)
    }
  }

  private sendSignal(message: Parameters<typeof encodeSignalling>[0]): void {
    if (this.signal?.readyState === WebSocket.OPEN) this.signal.send(encodeSignalling(message))
  }

  private async handleSignal(message: SignallingMessage): Promise<void> {
    switch (message.type) {
      case 'welcome':
        this.sessionId = message.sessionId
        return
      case 'vehicle.status':
        if (!message.online) {
          if (this.status.state !== 'connected') this.setStatus({ state: 'connecting' })
          return
        }
        // Vehicle (back) online: start a peer, or restart one that's stuck.
        if (!this.pc) await this.startPeer()
        else if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'disconnected') await this.restartIce()
        return
      case 'answer':
        if (!this.pc) return
        await this.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp })
        for (const candidate of this.pendingCandidates.splice(0)) await this.pc.addIceCandidate(candidate)
        return
      case 'ice':
        if (!this.pc) return
        console.info(`[WebRtcLink] remote candidate ${message.candidate.candidate.split(' ').slice(4, 8).join(' ')}`)
        if (this.pc.remoteDescription) await this.pc.addIceCandidate(message.candidate)
        else this.pendingCandidates.push(message.candidate)
        return
      case 'error':
        console.warn('[WebRtcLink] signalling error:', message.message)
        return
      default:
        return
    }
  }

  // --- peer connection ---------------------------------------------------

  private async startPeer(): Promise<void> {
    this.closePeer()
    this.lastRestartAt = null
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, iceTransportPolicy: this.relayOnly ? 'relay' : 'all' })
    this.pc = pc

    const telemetry = pc.createDataChannel('telemetry', { ordered: false, maxRetransmits: 0 })
    telemetry.binaryType = 'arraybuffer'
    telemetry.onmessage = (ev) => this.handleMessage(frameText(ev.data))
    const control = pc.createDataChannel('control', { ordered: true })
    control.binaryType = 'arraybuffer'
    control.onmessage = (ev) => this.handleMessage(frameText(ev.data))
    control.onopen = () => this.refreshStatus()
    control.onclose = () => this.refreshStatus()
    this.control = control
    pc.addTransceiver('video', { direction: 'recvonly' })

    pc.ontrack = (ev) => {
      this.videoStream = ev.streams[0] ?? new MediaStream([ev.track])
      for (const cb of this.videoListeners) cb(this.videoStream)
    }
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return
      console.info(`[WebRtcLink] local candidate ${ev.candidate.type ?? '?'} ${ev.candidate.protocol ?? ''} ${ev.candidate.address ?? ''}:${ev.candidate.port ?? ''}`)
      this.sendSignal({ type: 'ice', candidate: ev.candidate.toJSON() as IceCandidateInit })
    }
    pc.oniceconnectionstatechange = () => console.info(`[WebRtcLink] ICE ${pc.iceConnectionState}`)
    pc.onconnectionstatechange = () => this.onConnectionState(pc)

    this.statsTimer = setInterval(() => void this.pollStats(pc), STATS_INTERVAL_MS)
    await this.sendOffer(pc, false)
  }

  private async sendOffer(pc: RTCPeerConnection, iceRestart: boolean): Promise<void> {
    const offer = await pc.createOffer({ iceRestart })
    await pc.setLocalDescription(offer)
    if (offer.sdp) this.sendSignal({ type: 'offer', sdp: offer.sdp })
  }

  private async restartIce(): Promise<void> {
    if (!this.pc || this.signal?.readyState !== WebSocket.OPEN) return
    console.info('[WebRtcLink] ICE restart')
    this.lastRestartAt = Date.now()
    await this.sendOffer(this.pc, true)
  }

  private onConnectionState(pc: RTCPeerConnection): void {
    if (pc !== this.pc) return
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null

    switch (pc.connectionState) {
      case 'disconnected':
        this.restartTimer = setTimeout(() => void this.restartIce(), DISCONNECTED_RESTART_MS)
        break
      case 'failed':
        // Failing again soon after an ICE restart means the restart can't
        // work — typically the agent restarted and lost the session, so its
        // DTLS state no longer matches ours. Only a fresh connection recovers.
        if (this.lastRestartAt !== null && Date.now() - this.lastRestartAt < FRESH_PEER_AFTER_MS) void this.startPeer()
        else void this.restartIce()
        break
    }
    this.refreshStatus()
  }

  private closePeer(): void {
    if (this.statsTimer) clearInterval(this.statsTimer)
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.statsTimer = null
    this.restartTimer = null
    this.pc?.close()
    this.pc = null
    this.control = null
    this.pendingCandidates = []
    this.lastSample = null
    if (this.videoStream) {
      this.videoStream = null
      for (const cb of this.videoListeners) cb(null)
    }
  }

  // --- data channels ---------------------------------------------------------

  private request(message: Message): Promise<Message | null | 'not_connected'> {
    const id = message.id
    const control = this.control
    if (!id || !control || control.readyState !== 'open') return Promise.resolve('not_connected')

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(null)
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, (reply) => {
        clearTimeout(timer)
        resolve(reply)
      })
      control.send(encodeMessage(message))
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
      this.lastTelemetryAt = Date.now()
      for (const cb of this.stateListeners) cb(message.payload)
    } else if (message.type === 'telemetry.event') {
      for (const cb of this.eventListeners) cb(message.payload)
    }
  }

  // --- status ------------------------------------------------------------------

  private async pollStats(pc: RTCPeerConnection): Promise<void> {
    if (pc !== this.pc) return
    const report = await pc.getStats()
    const sample = summariseStats(report.values() as Iterable<StatsEntry>)
    const kbps = videoKbps(this.lastSample, sample)
    const lossPct = packetLossPct(this.lastSample, sample)
    if (sample.pairKinds && sample.pairKinds !== this.lastSample?.pairKinds) {
      console.info(`[WebRtcLink] selected pair ${sample.pairKinds} (${sample.path}, IPv${sample.ipVersion ?? '?'})`)
    }
    this.lastSample = sample
    this.refreshStatus(kbps, lossPct)
  }

  /** kbps and lossPct are per-interval figures, only known when stats were
   * just polled; between polls the last ones carry over. */
  private refreshStatus(kbps?: number, lossPct?: number): void {
    const pc = this.pc
    let state: LinkState = 'connecting'
    if (pc?.connectionState === 'connected' && this.control?.readyState === 'open') {
      const stale = this.lastTelemetryAt === undefined || Date.now() - this.lastTelemetryAt > TELEMETRY_STALE_MS
      state = stale ? 'degraded' : 'connected'
    } else if (pc?.connectionState === 'disconnected') {
      state = 'degraded'
    }
    const sample = this.lastSample
    this.setStatus({
      state,
      path: sample?.path,
      rttMs: sample?.rttMs,
      videoKbps: kbps ?? this.status.videoKbps,
      lastTelemetryAt: this.lastTelemetryAt,
      ipVersion: sample?.ipVersion,
      pairKinds: sample?.pairKinds,
      videoFps: sample?.videoFps,
      packetLossPct: lossPct ?? this.status.packetLossPct,
      jitterMs: sample?.jitterMs,
      videoFreezeCount: sample?.freezeCount,
      videoFreezeSeconds: sample?.freezeSeconds,
    })
  }

  private setStatus(status: LinkStatus): void {
    this.status = status
    for (const cb of this.statusListeners) cb(status)
  }
}
