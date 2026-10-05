import { describe, expect, it } from 'vitest'
import { decodeSignalling, encodeSignalling } from '../signalling'

describe('signalling codec', () => {
  it('round-trips an offer and stamps the version', () => {
    const raw = encodeSignalling({ type: 'offer', sdp: 'v=0', sessionId: 's1', sessionToken: 't' })
    expect(JSON.parse(raw).v).toBe(1)
    expect(decodeSignalling(raw)).toMatchObject({ type: 'offer', sdp: 'v=0', sessionId: 's1' })
  })

  it('accepts an ICE candidate in the shape Pion and browsers send (null mid/index allowed)', () => {
    const raw = JSON.stringify({ v: 1, type: 'ice', candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: null, sdpMLineIndex: null, usernameFragment: null } })
    expect(decodeSignalling(raw)?.type).toBe('ice')
  })

  it('rejects malformed JSON, unknown types and other versions', () => {
    expect(decodeSignalling('{')).toBeNull()
    expect(decodeSignalling(JSON.stringify({ v: 1, type: 'nope' }))).toBeNull()
    expect(decodeSignalling(JSON.stringify({ v: 2, type: 'welcome' }))).toBeNull()
  })
})
