import { z } from 'zod'

/**
 * Messages on the signalling WebSocket (browser ↔ server ↔ drone agent), which
 * brokers the WebRTC offer/answer and ICE candidates. Separate from the
 * data-channel `Message` set in messages.ts: these never travel over WebRTC.
 *
 * The server assigns each operator a `sessionId`, stamps it on what it
 * forwards to the vehicle and strips it from what it forwards back, so one
 * vehicle connection can serve several browser sessions. A session outlives
 * its signalling socket: the peer connection, not signalling, decides when it
 * ends. The agent/ (Go) mirrors these shapes by hand — change both together.
 *
 * v2 (ADR-0030): a drone proves its key before it's welcomed (hello →
 * challenge → auth → welcome), an operator's socket must carry a session
 * cookie, and offers carry a server-signed session token (auth.ts).
 */
export const SIGNALLING_VERSION = 2 as const

const iceCandidateSchema = z.object({
  candidate: z.string(),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().nullable().optional(),
  usernameFragment: z.string().nullable().optional(),
})

const base = { v: z.literal(SIGNALLING_VERSION) }

export const signallingMessageSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('hello'),
    role: z.enum(['vehicle', 'operator']),
    vehicleId: z.string(),
    /** Operator only: resume this session after a signalling reconnect, so a
     * later ICE restart still reaches the drone's existing peer connection. */
    sessionId: z.string().optional(),
  }),
  /** To a drone after its hello: sign this (auth.ts, vehicleAuthMessage). */
  z.object({ ...base, type: z.literal('challenge'), nonce: z.string() }),
  /** The drone's Ed25519 signature over the challenge, base64url. */
  z.object({ ...base, type: z.literal('auth'), signature: z.string() }),
  z.object({
    ...base,
    type: z.literal('welcome'),
    sessionId: z.string().optional(),
    /** To a drone: the server's clock (ms since the epoch), which session
     * token expiry is judged by, so a drone whose clock is wrong at boot
     * (no RTC, no NTP yet over LTE) still accepts fresh tokens. */
    serverTime: z.number().optional(),
  }),
  z.object({ ...base, type: z.literal('vehicle.status'), vehicleId: z.string(), online: z.boolean() }),
  z.object({
    ...base,
    type: z.literal('offer'),
    sdp: z.string(),
    sessionId: z.string().optional(),
    /** Server to drone only: the short-lived signed token the drone
     * verifies before answering (auth.ts; ARCHITECTURE.md session flow). */
    sessionToken: z.string().optional(),
  }),
  z.object({ ...base, type: z.literal('answer'), sdp: z.string(), sessionId: z.string().optional() }),
  z.object({ ...base, type: z.literal('ice'), candidate: iceCandidateSchema, sessionId: z.string().optional() }),
  z.object({ ...base, type: z.literal('error'), message: z.string() }),
])

export type SignallingMessage = z.infer<typeof signallingMessageSchema>
export type IceCandidateInit = z.infer<typeof iceCandidateSchema>

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export function encodeSignalling(message: DistributiveOmit<SignallingMessage, 'v'>): string {
  return JSON.stringify({ v: SIGNALLING_VERSION, ...message })
}

/** Null for malformed JSON, an unknown type or the wrong version — callers ignore it. */
export function decodeSignalling(raw: string): SignallingMessage | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const result = signallingMessageSchema.safeParse(json)
  return result.success ? result.data : null
}
