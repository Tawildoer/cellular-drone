import { describe, expect, it } from 'vitest'
import { summariseStats, videoKbps, type StatsEntry } from '../linkStats'

function report(localType: string, remoteType: string, extra: StatsEntry[] = []): StatsEntry[] {
  return [
    { id: 'T1', type: 'transport', selectedCandidatePairId: 'CP1' },
    { id: 'CP1', type: 'candidate-pair', localCandidateId: 'L1', remoteCandidateId: 'R1', currentRoundTripTime: 0.0425 },
    { id: 'L1', type: 'local-candidate', candidateType: localType },
    { id: 'R1', type: 'remote-candidate', candidateType: remoteType },
    ...extra,
  ]
}

describe('summariseStats', () => {
  it('reports a direct path, RTT in ms, and which candidate kinds were paired', () => {
    const sample = summariseStats(report('host', 'srflx'))
    expect(sample.path).toBe('direct')
    expect(sample.rttMs).toBe(43)
    expect(sample.pairKinds).toBe('host → srflx')
  })

  it('reports relayed when either end of the selected pair is a TURN relay candidate', () => {
    expect(summariseStats(report('relay', 'srflx')).path).toBe('relayed')
    expect(summariseStats(report('srflx', 'relay')).path).toBe('relayed')
  })

  it('falls back to a nominated, succeeded pair when no transport entry names one (Firefox)', () => {
    const sample = summariseStats([
      { id: 'CP1', type: 'candidate-pair', nominated: true, state: 'succeeded', localCandidateId: 'L1', remoteCandidateId: 'R1' },
      { id: 'L1', type: 'local-candidate', candidateType: 'host' },
      { id: 'R1', type: 'remote-candidate', candidateType: 'host' },
    ])
    expect(sample.path).toBe('direct')
  })

  it('is unknown before any pair is selected', () => {
    expect(summariseStats([{ id: 'T1', type: 'transport' }]).path).toBe('unknown')
  })
})

describe('videoKbps', () => {
  const video = (bytesReceived: number, timestamp: number): StatsEntry => ({ id: 'V', type: 'inbound-rtp', kind: 'video', bytesReceived, timestamp })

  it('computes the received bitrate between two samples', () => {
    const prev = summariseStats(report('host', 'host', [video(0, 1000)]))
    const next = summariseStats(report('host', 'host', [video(187_500, 2000)])) // 1.5 Mbit in 1 s
    expect(videoKbps(prev, next)).toBe(1500)
  })

  it('is undefined without a previous sample or video stats', () => {
    const next = summariseStats(report('host', 'host', [video(1000, 2000)]))
    expect(videoKbps(null, next)).toBeUndefined()
    expect(videoKbps(summariseStats(report('host', 'host')), summariseStats(report('host', 'host')))).toBeUndefined()
  })
})
