import type { Command, CommandResult, HomePosition, LinkStatus, Mission, VehicleEvent, VehicleState } from '../../domain'
import { createMessage, decodeMessage, encodeMessage } from '../../protocol'
import type { Unsubscribe, VehicleLink } from '../VehicleLink'
import { DroneEngine, type FaultInjectionConfig } from './droneEngine'

export type { FailsafeFaultConfig, FaultInjectionConfig } from './droneEngine'

export interface MockLinkOptions {
  tickMs?: number
  home?: HomePosition
  /** Multiplies simulated seconds per tick. Default 1 (real time); tests use higher values to fly missions fast. */
  timeScale?: number
  /** When set, connect() immediately uploads this mission, arms, starts it,
   * and fast-forwards the sim by `warmUpS` seconds, so the drone appears
   * already airborne mid-mission the moment the UI opens — the demo drone. */
  autoFly?: { mission: Mission; warmUpS?: number }
}

function delay(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The in-browser simulated VTOL that the whole UI is built against first
 * (ADR-0009, docs/FRONTEND.md). It speaks the same protocol/ messages a real
 * link would, round-tripping them through encode/decode, so the wire
 * contract gets exercised from day one even without a backend. The actual
 * flight simulation lives in DroneEngine (shared with mock-agent, ADR-0012);
 * this class is the browser-side transport shell around it — timers,
 * listeners, and canvas video.
 */
export class MockLink implements VehicleLink {
  private readonly tickMs: number
  private timeScale: number
  private readonly engine: DroneEngine
  private readonly autoFly?: { mission: Mission; warmUpS?: number }

  private connectedAtMs: number | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  private videoStream: MediaStream | null = null
  private videoDrawTimer: ReturnType<typeof setInterval> | null = null

  private readonly stateListeners = new Set<(s: VehicleState) => void>()
  private readonly statusListeners = new Set<(s: LinkStatus) => void>()
  private readonly eventListeners = new Set<(e: VehicleEvent) => void>()
  private readonly videoListeners = new Set<(s: MediaStream | null) => void>()

  constructor(opts: MockLinkOptions = {}) {
    this.tickMs = opts.tickMs ?? 100
    this.timeScale = opts.timeScale ?? 1
    this.engine = new DroneEngine({ home: opts.home })
    this.autoFly = opts.autoFly
  }

  async connect(vehicleId: string): Promise<void> {
    this.engine.connect(vehicleId)
    this.connectedAtMs = Date.now()
    this.setStatus({ state: 'connecting' })

    const fault = this.engine.getFaultConfig()
    await delay(fault.latencyMs)

    this.setStatus({
      state: fault.linkDropped ? 'disconnected' : 'connected',
      path: 'direct',
      rttMs: fault.latencyMs,
      lastTelemetryAt: Date.now(),
    })
    this.startVideo()
    if (this.autoFly && !fault.linkDropped) this.runAutoFly(this.autoFly)
    this.emitState()
    this.timer = setInterval(() => this.tick(), this.tickMs)
  }

  /** Puts the sim straight into a flying mission (demo drone): upload, arm,
   * start, then fast-forward so the UI opens on an already-airborne vehicle.
   * Warm-up events are discarded — they'd all carry "now" as their time. */
  private runAutoFly({ mission, warmUpS = 0 }: { mission: Mission; warmUpS?: number }): void {
    this.engine.uploadMission(mission)
    this.engine.applyCommand({ type: 'arm' })
    this.engine.applyCommand({ type: 'mission.start' })
    const step = 0.2
    for (let t = 0; t < warmUpS; t += step) this.engine.tick(step)
  }

  async disconnect(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.stopVideo()
    this.connectedAtMs = null
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
    if (!this.connectedAtMs) return { ok: false, reason: 'not_connected' }

    const fault = this.engine.getFaultConfig()
    await delay(fault.latencyMs)
    if (fault.linkDropped) return { ok: false, reason: 'timeout' }

    const decodedReq = decodeMessage(encodeMessage(createMessage('cmd.request', cmd)))
    if (!decodedReq || decodedReq.type !== 'cmd.request') return { ok: false, reason: 'rejected_by_vehicle' }

    const result = this.engine.applyCommand(decodedReq.payload)

    const decodedRes = decodeMessage(encodeMessage(createMessage('cmd.result', result)))
    return decodedRes && decodedRes.type === 'cmd.result' ? decodedRes.payload : result
  }

  async uploadMission(mission: Mission): Promise<CommandResult> {
    if (!this.connectedAtMs) return { ok: false, reason: 'not_connected' }

    const fault = this.engine.getFaultConfig()
    await delay(fault.latencyMs)
    if (fault.linkDropped) return { ok: false, reason: 'timeout' }

    const decoded = decodeMessage(encodeMessage(createMessage('mission.upload', mission)))
    if (!decoded || decoded.type !== 'mission.upload') {
      return { ok: false, reason: 'rejected_by_vehicle', detail: 'malformed mission' }
    }

    return this.engine.uploadMission(decoded.payload)
  }

  async downloadMission(): Promise<Mission | null> {
    if (!this.connectedAtMs) return null

    const decoded = decodeMessage(encodeMessage(createMessage('mission.current', this.engine.downloadMission())))
    return decoded && decoded.type === 'mission.current' ? decoded.payload : null
  }

  setFaultConfig(partial: Partial<FaultInjectionConfig>): void {
    const event = this.engine.setFaultConfig(partial)
    if (event) this.emitEvent(event)
  }

  getFaultConfig(): FaultInjectionConfig {
    return this.engine.getFaultConfig()
  }

  /** Multiplies simulated seconds per tick — e.g. 5 flies the mission 5x
   * faster without changing the tick interval. Dev-tooling only. */
  setTimeScale(scale: number): void {
    this.timeScale = scale
  }

  getTimeScale(): number {
    return this.timeScale
  }

  // --- internals -----------------------------------------------------

  private tick(): void {
    if (!this.connectedAtMs) return

    const fault = this.engine.getFaultConfig()
    if (fault.linkDropped) {
      this.setStatus({ state: 'disconnected' })
      return
    }

    const dtS = (this.tickMs / 1000) * this.timeScale
    for (const event of this.engine.tick(dtS)) this.emitEvent(event)

    this.emitState()
    this.setStatus({
      state: 'connected',
      path: 'direct',
      rttMs: fault.latencyMs,
      lastTelemetryAt: Date.now(),
    })
  }

  private emitState(): void {
    if (Math.random() < this.engine.getFaultConfig().lossRate) return

    const decoded = decodeMessage(encodeMessage(createMessage('telemetry.state', this.engine.buildVehicleState())))
    if (decoded && decoded.type === 'telemetry.state') {
      for (const cb of this.stateListeners) cb(decoded.payload)
    }
  }

  private emitEvent(event: VehicleEvent): void {
    const decoded = decodeMessage(encodeMessage(createMessage('telemetry.event', event)))
    if (decoded && decoded.type === 'telemetry.event') {
      for (const cb of this.eventListeners) cb(decoded.payload)
    }
  }

  private setStatus(status: LinkStatus): void {
    for (const cb of this.statusListeners) cb(status)
  }

  private startVideo(): void {
    if (typeof document === 'undefined') return

    const canvas = document.createElement('canvas')
    if (typeof canvas.captureStream !== 'function') return
    canvas.width = 640
    canvas.height = 360
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    this.videoDrawTimer = setInterval(() => this.drawVideoFrame(ctx), 1000 / 15)
    this.videoStream = canvas.captureStream(15)
    for (const cb of this.videoListeners) cb(this.videoStream)
  }

  private drawVideoFrame(ctx: CanvasRenderingContext2D): void {
    const { width: w, height: h } = ctx.canvas
    const rollDeg = Math.sin(Date.now() / 2000) * 8
    const state = this.engine.buildVehicleState()

    ctx.save()
    ctx.translate(w / 2, h / 2)
    ctx.rotate((rollDeg * Math.PI) / 180)
    ctx.fillStyle = '#4a7fb5'
    ctx.fillRect(-w, -h, 2 * w, h)
    ctx.fillStyle = '#5b3a29'
    ctx.fillRect(-w, 0, 2 * w, h)
    ctx.restore()

    ctx.fillStyle = '#fff'
    ctx.font = '16px monospace'
    ctx.fillText(`HDG ${state.attitude.yawDeg.toFixed(0).padStart(3, '0')}`, 12, 24)
    ctx.fillText(`ALT ${state.position.altRelM.toFixed(0)}m`, 12, 44)
    ctx.fillText(`SPD ${state.groundSpeedMps.toFixed(1)}m/s`, 12, 64)
    ctx.fillText(`VID ${this.engine.getVideoPreset().toUpperCase()}`, 12, 84)
  }

  private stopVideo(): void {
    if (this.videoDrawTimer) {
      clearInterval(this.videoDrawTimer)
      this.videoDrawTimer = null
    }
    if (this.videoStream) {
      for (const track of this.videoStream.getTracks()) track.stop()
    }
    this.videoStream = null
    for (const cb of this.videoListeners) cb(null)
  }
}
