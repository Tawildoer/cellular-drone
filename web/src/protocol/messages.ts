import { z } from 'zod'
import {
  commandResultSchema,
  commandSchema,
  missionSchema,
  vehicleEventSchema,
  vehicleStateSchema,
} from './schemas'

export const PROTOCOL_VERSION = 1 as const

const emptyPayloadSchema = z.object({}).strict()

const missionUploadedPayloadSchema = z.object({
  missionId: z.string(),
  result: commandResultSchema,
})

const videoConfigPayloadSchema = z.object({ preset: z.enum(['low', 'medium', 'high']) })

function envelope<Type extends string, Payload extends z.ZodType>(type: Type, payload: Payload) {
  return z.object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal(type),
    id: z.string().optional(),
    ts: z.number(),
    payload,
  })
}

const telemetryStateMessageSchema = envelope('telemetry.state', vehicleStateSchema)
const telemetryEventMessageSchema = envelope('telemetry.event', vehicleEventSchema)
const cmdRequestMessageSchema = envelope('cmd.request', commandSchema)
const cmdResultMessageSchema = envelope('cmd.result', commandResultSchema)
const missionUploadMessageSchema = envelope('mission.upload', missionSchema)
const missionUploadedMessageSchema = envelope('mission.uploaded', missionUploadedPayloadSchema)
const missionDownloadMessageSchema = envelope('mission.download', emptyPayloadSchema)
const missionCurrentMessageSchema = envelope('mission.current', missionSchema.nullable())
const videoConfigMessageSchema = envelope('video.config', videoConfigPayloadSchema)
const pingMessageSchema = envelope('ping', emptyPayloadSchema)
const pongMessageSchema = envelope('pong', emptyPayloadSchema)

/** The full set of message types carried over the `telemetry` / `control`
 * data channels (docs/FRONTEND.md section 3). Unknown types fail this union
 * and are dropped by `decodeMessage` — that's the forward-compatibility rule. */
export const messageSchema = z.discriminatedUnion('type', [
  telemetryStateMessageSchema,
  telemetryEventMessageSchema,
  cmdRequestMessageSchema,
  cmdResultMessageSchema,
  missionUploadMessageSchema,
  missionUploadedMessageSchema,
  missionDownloadMessageSchema,
  missionCurrentMessageSchema,
  videoConfigMessageSchema,
  pingMessageSchema,
  pongMessageSchema,
])

export type Message = z.infer<typeof messageSchema>
export type MessageType = Message['type']

export type MessagePayloadMap = {
  [K in Message['type']]: Extract<Message, { type: K }>['payload']
}

/** Builds a typed, versioned envelope around a payload. Does not validate —
 * callers construct payloads from typed domain values, so the only
 * untrusted path is `decodeMessage`. */
export function createMessage<T extends MessageType>(
  type: T,
  payload: MessagePayloadMap[T],
  opts: { id?: string; ts?: number } = {},
): Extract<Message, { type: T }> {
  return {
    v: PROTOCOL_VERSION,
    type,
    id: opts.id,
    ts: opts.ts ?? Date.now(),
    payload,
  } as Extract<Message, { type: T }>
}
