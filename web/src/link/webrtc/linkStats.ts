import type { LinkPath } from '../../domain'

/** One entry of an RTCStatsReport, loosely typed: browsers differ in which
 * fields they fill, so everything beyond id/type is read defensively. */
export type StatsEntry = { id: string; type: string; timestamp?: number } & Record<string, unknown>

export interface LinkSample {
  path: LinkPath
  /** e.g. "host → srflx" — which kinds of candidate the selected pair joins. */
  pairKinds?: string
  ipVersion?: 4 | 6
  rttMs?: number
  timestampMs?: number
  // Cumulative inbound video counters (inbound-rtp), as the browser reports them.
  videoBytesReceived?: number
  packetsReceived?: number
  packetsLost?: number
  videoFps?: number
  jitterMs?: number
  freezeCount?: number
  freezeSeconds?: number
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** The remote end's address is the real one (local host candidates can be
 * hidden behind mDNS names), so it says which IP version the path uses. */
function ipVersionOf(candidate: StatsEntry | undefined): 4 | 6 | undefined {
  const address = str(candidate?.address) ?? str(candidate?.ip)
  if (!address) return undefined
  return address.includes(':') ? 6 : 4
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
  const jitter = num(video?.jitter)
  const sample: LinkSample = {
    path: 'unknown',
    timestampMs: num(video?.timestamp),
    videoBytesReceived: num(video?.bytesReceived),
    packetsReceived: num(video?.packetsReceived),
    packetsLost: num(video?.packetsLost),
    videoFps: num(video?.framesPerSecond),
    jitterMs: jitter !== undefined ? Math.round(jitter * 1000) : undefined,
    freezeCount: num(video?.freezeCount),
    freezeSeconds: num(video?.totalFreezesDuration),
  }
  if (!pair) return sample

  const localEntry = byId.get(str(pair.localCandidateId) ?? '')
  const remoteEntry = byId.get(str(pair.remoteCandidateId) ?? '')
  const local = str(localEntry?.candidateType)
  const remote = str(remoteEntry?.candidateType)
  const rtt = num(pair.currentRoundTripTime)

  return {
    ...sample,
    path: local === 'relay' || remote === 'relay' ? 'relayed' : 'direct',
    pairKinds: local && remote ? `${local} → ${remote}` : undefined,
    ipVersion: ipVersionOf(remoteEntry),
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

/** Share of video packets lost between two samples, 0–100. Undefined when
 * no packets were expected in between (nothing to judge). */
export function packetLossPct(prev: LinkSample | null, next: LinkSample): number | undefined {
  if (!prev || prev.packetsLost === undefined || next.packetsLost === undefined) return undefined
  if (prev.packetsReceived === undefined || next.packetsReceived === undefined) return undefined
  const lost = Math.max(0, next.packetsLost - prev.packetsLost)
  const received = Math.max(0, next.packetsReceived - prev.packetsReceived)
  const expected = lost + received
  return expected > 0 ? Math.round((lost / expected) * 1000) / 10 : undefined
}
