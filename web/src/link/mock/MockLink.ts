import type { Command, CommandResult, HomePosition, LinkStatus, Mission, MissionUploadResult, VehicleEvent, VehicleState } from '../../domain'
import { createMessage, decodeMessage, encodeMessage } from '../../protocol'
import type { Unsubscribe, VehicleLink } from '../VehicleLink'
import { DroneEngine, type FaultInjectionConfig } from './droneEngine'
import { INITIAL_LINK_CONDITIONS, nextLinkConditions, type LinkConditions } from './linkConditions'

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

/** How long a camera switch shows black before the new picture. */
const CAMERA_SWITCH_MS = 500

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
  private conditions: LinkConditions = INITIAL_LINK_CONDITIONS
  /** The simulated modem's SINR, which the link's delay and loss follow. */
  private sinrDb: number | undefined

  private videoStream: MediaStream | null = null
  private videoDrawTimer: ReturnType<typeof setInterval> | null = null
  private shownCameraId: string | null = null
  private cameraSwitchedAtMs = 0

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

    // Before announcing "connected": the store downloads the vehicle's
    // mission on that transition, so the demo's must already be loaded.
    if (this.autoFly && !fault.linkDropped) this.runAutoFly(this.autoFly)
    this.setStatus({
      state: fault.linkDropped ? 'disconnected' : 'connected',
      path: 'direct',
      ...this.reportedQuality(fault.latencyMs),
      lastTelemetryAt: Date.now(),
    })
    this.startVideo()
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
    if (!decodedReq || decodedReq.type !== 'cmd.request') {
      return { ok: false, reason: 'rejected_by_vehicle', detail: `malformed ${cmd.type} command` }
    }

    const result = this.engine.applyCommand(decodedReq.payload)

    const decodedRes = decodeMessage(encodeMessage(createMessage('cmd.result', result)))
    return decodedRes && decodedRes.type === 'cmd.result' ? decodedRes.payload : result
  }

  async uploadMission(mission: Mission): Promise<MissionUploadResult> {
    if (!this.connectedAtMs) return { ok: false, reason: 'not_connected' }

    const fault = this.engine.getFaultConfig()
    await delay(fault.latencyMs)
    if (fault.linkDropped) return { ok: false, reason: 'timeout' }

    const decoded = decodeMessage(encodeMessage(createMessage('mission.upload', mission)))
    if (!decoded || decoded.type !== 'mission.upload') {
      return { ok: false, reason: 'rejected_by_vehicle', detail: 'malformed mission' }
    }

    // Round-trip the reply too, so the readback is held to the wire schema.
    const result = this.engine.uploadMission(decoded.payload)
    const { onVehicle, ...commandResult } = result
    const reply = decodeMessage(
      encodeMessage(createMessage('mission.uploaded', { missionId: decoded.payload.id, result: commandResult, onVehicle })),
    )
    return reply && reply.type === 'mission.uploaded' ? { ...reply.payload.result, onVehicle: reply.payload.onVehicle } : result
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
    const dtS = (this.tickMs / 1000) * this.timeScale
    // The drone flies on without its link, as a real one does: only what it
    // says is lost, and the browser sees it again where it's got to.
    const events = this.engine.tick(dtS)
    if (fault.linkDropped) {
      this.setStatus({ state: 'disconnected' })
      return
    }
    for (const event of events) this.emitEvent(event)

    this.emitState()
    // Real time, not sim time: the link doesn't speed up with the sim.
    this.conditions = nextLinkConditions(this.conditions, this.tickMs / 1000, Math.random, this.sinrDb)
    this.setStatus({
      state: 'connected',
      path: 'direct',
      ...this.reportedQuality(fault.latencyMs),
      lastTelemetryAt: Date.now(),
    })
  }

  /** The simulated LTE conditions (linkConditions.ts), plus any injected latency. */
  private reportedQuality(latencyMs: number): Pick<LinkStatus, 'rttMs' | 'videoFps' | 'packetLossPct'> {
    return {
      rttMs: Math.round(latencyMs + this.conditions.rttMs),
      videoFps: Math.round(this.conditions.videoFps * 10) / 10,
      packetLossPct: Math.round(this.conditions.packetLossPct * 100) / 100,
    }
  }

  private emitState(): void {
    const state = this.engine.buildVehicleState()
    this.sinrDb = state.cellular?.sinrDb
    if (Math.random() < this.engine.getFaultConfig().lossRate) return

    const decoded = decodeMessage(encodeMessage(createMessage('telemetry.state', state)))
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

  /** A test picture per camera (ADR-0029): the gimbal looking ahead and
   * down, the nose camera at the horizon with a centre mark, the belly
   * camera straight down at fields passing underneath. Switching shows a
   * moment of black, as a real stream does while the new camera's first
   * keyframe arrives. */
  private drawVideoFrame(ctx: CanvasRenderingContext2D): void {
    const { width: w, height: h } = ctx.canvas
    const state = this.engine.buildVehicleState()
    const camera = this.engine.getActiveCamera()
    if (camera.id !== this.shownCameraId) {
      // Black only for a switch, not the stream's first frame.
      if (this.shownCameraId !== null) this.cameraSwitchedAtMs = Date.now()
      this.shownCameraId = camera.id
    }

    if (Date.now() - this.cameraSwitchedAtMs < CAMERA_SWITCH_MS) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#888'
      ctx.font = '16px monospace'
      ctx.fillText(`Switching to ${camera.name}…`, 12, 24)
      return
    }

    if (camera.id === 'belly') {
      this.drawBellyView(ctx, state.position.lat, state.position.lon, state.position.altRelM, state.attitude.yawDeg)
    } else {
      const rollDeg = Math.sin(Date.now() / 2000) * 8
      // The gimbal looks down 45°, which lifts the horizon up the frame.
      const horizonY = camera.kind === 'gimbal' ? -h * 0.3 : 0
      ctx.save()
      ctx.translate(w / 2, h / 2)
      ctx.rotate((rollDeg * Math.PI) / 180)
      ctx.fillStyle = '#4a7fb5'
      ctx.fillRect(-w, -2 * h + horizonY, 2 * w, 2 * h)
      ctx.fillStyle = '#5b3a29'
      ctx.fillRect(-w, horizonY, 2 * w, 2 * h)
      ctx.restore()
      if (camera.id === 'nose') {
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(w / 2 - 24, h / 2)
        ctx.lineTo(w / 2 - 8, h / 2)
        ctx.moveTo(w / 2 + 8, h / 2)
        ctx.lineTo(w / 2 + 24, h / 2)
        ctx.stroke()
      }
    }

    ctx.fillStyle = '#fff'
    ctx.font = '16px monospace'
    ctx.fillText(`CAM ${camera.name.toUpperCase()}`, 12, 24)
    ctx.fillText(`HDG ${state.attitude.yawDeg.toFixed(0).padStart(3, '0')}`, 12, 44)
    ctx.fillText(`ALT ${state.position.altRelM.toFixed(0)}m`, 12, 64)
    ctx.fillText(`SPD ${state.groundSpeedMps.toFixed(1)}m/s`, 12, 84)
    ctx.fillText(`VID ${this.engine.getVideoPreset().toUpperCase()}`, 12, 104)
  }

  /** Straight down: a patchwork of fields, 60 m squares, sliding past as
   * the drone flies and shrinking as it climbs; heading up the frame. */
  private drawBellyView(ctx: CanvasRenderingContext2D, lat: number, lon: number, altM: number, headingDeg: number): void {
    const { width: w, height: h } = ctx.canvas
    const field = 60
    const northM = lat * 111_320
    const eastM = lon * 111_320 * Math.cos((lat * Math.PI) / 180)
    // A 90° lens: the frame's width covers twice the height on the ground.
    const pxPerM = w / Math.max(4, 2 * Math.max(1, altM))
    const sizePx = field * pxPerM
    ctx.save()
    ctx.fillStyle = '#4f6b34'
    ctx.fillRect(0, 0, w, h)
    ctx.translate(w / 2, h / 2)
    ctx.rotate((-headingDeg * Math.PI) / 180)
    const reach = Math.ceil(Math.hypot(w, h) / 2 / sizePx) + 1
    const col0 = Math.floor(eastM / field)
    const row0 = Math.floor(northM / field)
    for (let r = -reach; r <= reach; r++) {
      for (let c = -reach; c <= reach; c++) {
        const shade = ((col0 + c) * 7 + (row0 + r) * 13) % 4
        ctx.fillStyle = ['#4f6b34', '#6b7d3a', '#8a7a45', '#3e5a2b'][Math.abs(shade)]!
        const x = ((col0 + c) * field - eastM) * pxPerM
        const y = -((row0 + r + 1) * field - northM) * pxPerM
        ctx.fillRect(x, y, sizePx - 1, sizePx - 1)
      }
    }
    ctx.restore()
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
