import type { LinkPath } from '../../domain'

/** One entry of an RTCStatsReport, loosely typed: browsers differ in which
 * fields they fill, so everything beyond id/type is read defensively. */
export type StatsEntry = { id: string; type: string; timestamp?: number } & Record<string, unknown>

export interface LinkSample {
  path: LinkPath
  /** e.g. "host → srflx" — which kinds of candidate the selected pair joins. */
  pairKinds?: string
  rttMs?: number
  videoBytesReceived?: number
  timestampMs?: number
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** The selected candidate pair decides the path: if either end is a TURN
 * relay candidate, traffic goes through the relay. */
export function summariseStats(entries: Iterable<StatsEntry>): LinkSample {
  const all = [...entries]
  const byId = new Map(all.map((entry) => [entry.id, entry]))

  const transport = all.find((entry) => entry.type === 'transport')
  const selectedId = str(transport?.selectedCandidatePairId)
  const pair =
    (selectedId ? byId.get(selectedId) : undefined) ??
    all.find((entry) => entry.type === 'candidate-pair' && (entry.selected === true || (entry.nominated === true && entry.state === 'succeeded')))

  const video = all.find((entry) => entry.type === 'inbound-rtp' && entry.kind === 'video')
  const sample: LinkSample = {
    path: 'unknown',
    videoBytesReceived: num(video?.bytesReceived),
    timestampMs: num(video?.timestamp),
  }
  if (!pair) return sample

  const local = str(byId.get(str(pair.localCandidateId) ?? '')?.candidateType)
  const remote = str(byId.get(str(pair.remoteCandidateId) ?? '')?.candidateType)
  const rtt = num(pair.currentRoundTripTime)

  return {
    ...sample,
    path: local === 'relay' || remote === 'relay' ? 'relayed' : 'direct',
    pairKinds: local && remote ? `${local} → ${remote}` : undefined,
    rttMs: rtt !== undefined ? Math.round(rtt * 1000) : undefined,
  }
}

/** Received video bitrate between two samples, in kbit/s. */
export function videoKbps(prev: LinkSample | null, next: LinkSample): number | undefined {
  if (!prev || prev.videoBytesReceived === undefined || next.videoBytesReceived === undefined) return undefined
  if (prev.timestampMs === undefined || next.timestampMs === undefined || next.timestampMs <= prev.timestampMs) return undefined
  // bytes × 8 / ms = kbit/s
  return Math.round(((next.videoBytesReceived - prev.videoBytesReceived) * 8) / (next.timestampMs - prev.timestampMs))
}
