import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  SESSION_TOKEN_CONTEXT,
  SESSION_TOKEN_VERSION,
  vehicleAuthMessage,
  type SessionTokenClaims,
} from '@cellular-drone/protocol'

/**
 * Ed25519 keys (ADR-0030). Public keys travel as base64url of the raw 32
 * bytes: what `agent -print-key` prints and the agent's -server-pubkey takes.
 */

export interface SigningKey {
  privateKey: KeyObject
  /** For the agents' -server-pubkey. */
  publicKey: string
}

function toSigningKey(privateKey: KeyObject): SigningKey {
  return { privateKey, publicKey: rawPublicKey(createPublicKey(privateKey)) }
}

export function rawPublicKey(key: KeyObject): string {
  const jwk = key.export({ format: 'jwk' })
  if (jwk.crv !== 'Ed25519' || !jwk.x) throw new Error('not an Ed25519 key')
  return jwk.x
}

/**
 * The server's session-signing key, from a PKCS#8 PEM file, created (mode
 * 0600) on first use. No file ('') = a fresh key per process, for tests.
 * Losing the file only means re-giving the new public key to every drone.
 */
export function loadOrCreateSigningKey(file: string): SigningKey {
  if (!file) return toSigningKey(generateKeyPairSync('ed25519').privateKey)
  if (existsSync(file)) return toSigningKey(createPrivateKey(readFileSync(file)))
  mkdirSync(path.dirname(file), { recursive: true })
  const { privateKey } = generateKeyPairSync('ed25519')
  writeFileSync(file, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' })
  return toSigningKey(privateKey)
}

/** A drone's public key as given to `drone:add`; throws if it isn't one. */
export function parsePublicKey(raw: string): KeyObject {
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new Error('a public key is 43 base64url characters (agent -print-key)')
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw }, format: 'jwk' })
}

/** An Ed25519 signature (base64url) over `message`. */
export function verifySignature(publicKey: KeyObject, message: string, signature: string): boolean {
  const sig = Buffer.from(signature, 'base64url')
  if (sig.length !== 64) return false
  return verify(null, Buffer.from(message), publicKey, sig)
}

export function verifyVehicleSignature(publicKey: KeyObject, vehicleId: string, nonce: string, signature: string): boolean {
  return verifySignature(publicKey, vehicleAuthMessage(vehicleId, nonce), signature)
}

export function mintSessionToken(key: KeyObject, claims: Omit<SessionTokenClaims, 'v'>): string {
  const payload = Buffer.from(JSON.stringify({ v: SESSION_TOKEN_VERSION, ...claims })).toString('base64url')
  const signature = sign(null, Buffer.from(SESSION_TOKEN_CONTEXT + payload), key).toString('base64url')
  return `${payload}.${signature}`
}
