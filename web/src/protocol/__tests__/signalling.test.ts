import { describe, expect, it } from 'vitest'
import { SIGNALLING_VERSION, decodeSignalling, encodeSignalling } from '..'

describe('signalling codec', () => {
  it('round-trips an offer and stamps the version', () => {
    const raw = encodeSignalling({ type: 'offer', sdp: 'v=0', sessionId: 's1', sessionToken: 't' })
    expect(JSON.parse(raw).v).toBe(SIGNALLING_VERSION)
    expect(decodeSignalling(raw)).toMatchObject({ type: 'offer', sdp: 'v=0', sessionId: 's1' })
  })

  it('accepts an ICE candidate in the shape Pion and browsers send (null mid/index allowed)', () => {
    const raw = JSON.stringify({ v: SIGNALLING_VERSION, type: 'ice', candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: null, sdpMLineIndex: null, usernameFragment: null } })
    expect(decodeSignalling(raw)?.type).toBe('ice')
  })

  it('rejects malformed JSON, unknown types and other versions', () => {
    expect(decodeSignalling('{')).toBeNull()
    expect(decodeSignalling(JSON.stringify({ v: SIGNALLING_VERSION, type: 'nope' }))).toBeNull()
    expect(decodeSignalling(JSON.stringify({ v: 1, type: 'welcome' }))).toBeNull()
  })

  it('carries the v2 drone handshake: challenge, auth, and the server clock in welcome', () => {
    expect(decodeSignalling(encodeSignalling({ type: 'challenge', nonce: 'n' }))).toMatchObject({ type: 'challenge', nonce: 'n' })
    expect(decodeSignalling(encodeSignalling({ type: 'auth', signature: 's' }))).toMatchObject({ type: 'auth', signature: 's' })
    expect(decodeSignalling(encodeSignalling({ type: 'welcome', serverTime: 5 }))).toMatchObject({ type: 'welcome', serverTime: 5 })
  })
})
