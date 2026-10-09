import { describe, expect, it } from 'vitest'
import { formatLinkBadge } from '../linkFormat'

describe('formatLinkBadge', () => {
  it('is critical/No link for null status', () => {
    expect(formatLinkBadge(null)).toEqual({ label: 'No link', status: 'critical' })
  })

  it('is critical/No link for an explicit disconnected state', () => {
    expect(formatLinkBadge({ state: 'disconnected' })).toEqual({ label: 'No link', status: 'critical' })
  })

  it('is warning/Connecting while connecting', () => {
    expect(formatLinkBadge({ state: 'connecting' })).toEqual({ label: 'Linking', status: 'warning' })
  })

  it('shows Direct with RTT when connected direct', () => {
    expect(formatLinkBadge({ state: 'connected', path: 'direct', rttMs: 42.6 })).toEqual({
      label: 'Direct',
      detail: '43 ms',
      status: 'good',
    })
  })

  it('shows Relayed when connected via relay', () => {
    expect(formatLinkBadge({ state: 'connected', path: 'relayed' })).toEqual({
      label: 'Relayed',
      detail: undefined,
      status: 'good',
    })
  })

  it('is warning when degraded', () => {
    expect(formatLinkBadge({ state: 'degraded', path: 'direct' })).toMatchObject({ status: 'warning' })
  })

  it('falls back to Connected when path is unknown', () => {
    expect(formatLinkBadge({ state: 'connected', path: 'unknown' })).toMatchObject({ label: 'Linked' })
  })

  it('keeps the detail to latency, even when the IP version is known', () => {
    expect(formatLinkBadge({ state: 'connected', path: 'direct', rttMs: 45, ipVersion: 6 })).toMatchObject({ detail: '45 ms' })
  })

  it('turns critical when latency is poor, even though the link is up', () => {
    expect(formatLinkBadge({ state: 'connected', path: 'direct', rttMs: 600 })).toMatchObject({ status: 'critical' })
  })
})

describe('formatLinkBadge and video', () => {
  it('stays good on low latency even when the video feed is poor (the video badge covers that)', () => {
    expect(formatLinkBadge({ state: 'connected', path: 'direct', rttMs: 45, videoFps: 5 })).toMatchObject({ status: 'good' })
  })
})
