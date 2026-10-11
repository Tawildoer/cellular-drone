import { z } from 'zod'

/**
 * The two signatures in the session flow (ADR-0030), shared by the server
 * and mirrored by hand in agent/internal/auth: change both together.
 * testdata/auth/vectors.json holds known answers both sides are tested on.
 *
 * Each signed message starts with its own context string, so a signature
 * made for one purpose can never be passed off as the other.
 */

/** A drone proving its key: Ed25519 over `context + vehicleId + "\n" + nonce`,
 * signed with the drone's own key; the server holds only the public half. */
export const VEHICLE_AUTH_CONTEXT = 'cellular-drone/vehicle-auth/v1\n'

export function vehicleAuthMessage(vehicleId: string, nonce: string): string {
  return `${VEHICLE_AUTH_CONTEXT}${vehicleId}\n${nonce}`
}

/**
 * A session token: `<payload>.<signature>`, both base64url (no padding).
 * The payload is the claims as JSON; the signature is the server's Ed25519
 * over `SESSION_TOKEN_CONTEXT + <payload>`. The drone checks the signature,
 * that it names this vehicle and this session, and the expiry against the
 * server's clock (signalling welcome's serverTime).
 */
export const SESSION_TOKEN_CONTEXT = 'cellular-drone/session/v1.'
export const SESSION_TOKEN_VERSION = 1 as const

export const sessionTokenClaimsSchema = z.object({
  v: z.literal(SESSION_TOKEN_VERSION),
  /** The signed-in user's name: who the drone's flight log records. */
  sub: z.string(),
  role: z.enum(['admin', 'operator']),
  vehicleId: z.string(),
  sessionId: z.string(),
  /** Seconds since the epoch, server clock. */
  iat: z.number().int(),
  exp: z.number().int(),
})

export type SessionTokenClaims = z.infer<typeof sessionTokenClaimsSchema>
