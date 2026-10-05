import { messageSchema, type Message } from './messages'

export function encodeMessage(message: Message): string {
  return JSON.stringify(message)
}

/** Parses and validates a wire message. Returns `null` for malformed JSON,
 * the wrong protocol version, or a `type` this build doesn't know about —
 * callers should silently ignore `null` to stay forward-compatible. */
export function decodeMessage(raw: string): Message | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }

  const result = messageSchema.safeParse(json)
  return result.success ? result.data : null
}
