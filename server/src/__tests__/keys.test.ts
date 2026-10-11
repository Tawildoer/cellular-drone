import assert from 'node:assert/strict'
import { createPrivateKey, createPublicKey, verify } from 'node:crypto'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { SESSION_TOKEN_CONTEXT, sessionTokenClaimsSchema } from '@cellular-drone/protocol'
import { loadOrCreateSigningKey, mintSessionToken, parsePublicKey, rawPublicKey, verifyVehicleSignature } from '../keys.ts'

/** Shared with the Go agent's tests: both sides must agree on these bytes. */
const vectors = JSON.parse(readFileSync(new URL('../../../testdata/auth/vectors.json', import.meta.url), 'utf8'))

const fromSeed = (hex: string) =>
  createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(hex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  })

describe('session tokens', () => {
  it('match the known answer the agent is tested against', () => {
    const { serverSeedHex, serverPublicKey, claims, token } = vectors.session
    const key = fromSeed(serverSeedHex)
    assert.equal(rawPublicKey(createPublicKey(key)), serverPublicKey)
    const { v: _v, ...rest } = claims
    assert.equal(mintSessionToken(key, rest), token)
  })

  it('carry claims the protocol schema accepts, signed over the context and payload', () => {
    const key = loadOrCreateSigningKey('')
    const token = mintSessionToken(key.privateKey, {
      sub: 'pilot', role: 'admin', vehicleId: 'drone-1', sessionId: 's1', iat: 100, exp: 160,
    })
    const [payload, signature] = token.split('.')
    assert.ok(sessionTokenClaimsSchema.safeParse(JSON.parse(Buffer.from(payload!, 'base64url').toString())).success)
    assert.ok(
      verify(null, Buffer.from(SESSION_TOKEN_CONTEXT + payload), parsePublicKey(key.publicKey), Buffer.from(signature!, 'base64url')),
    )
  })
})

describe('vehicle signatures', () => {
  const { dronePublicKey, vehicleId, nonce, signature } = vectors.vehicleAuth

  it("accept the agent's known answer", () => {
    assert.equal(verifyVehicleSignature(parsePublicKey(dronePublicKey), vehicleId, nonce, signature), true)
  })

  it('refuse another nonce, another vehicle id or a bad signature', () => {
    const key = parsePublicKey(dronePublicKey)
    assert.equal(verifyVehicleSignature(key, vehicleId, `${nonce}x`, signature), false)
    assert.equal(verifyVehicleSignature(key, 'drone-2', nonce, signature), false)
    assert.equal(verifyVehicleSignature(key, vehicleId, nonce, 'AAAA'), false)
  })
})

describe('keys', () => {
  it('creates the signing key once, private to its owner, and loads it after', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'cd-keys-')), 'nested', 'signing.key')
    const first = loadOrCreateSigningKey(file)
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.equal(loadOrCreateSigningKey(file).publicKey, first.publicKey)
  })

  it('refuses something that is not a public key', () => {
    assert.throws(() => parsePublicKey('not-a-key'), /43 base64url/)
  })
})
