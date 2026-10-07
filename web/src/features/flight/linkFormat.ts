import type { StatStatus } from '../../components/StatTile'
import type { LinkStatus } from '../../domain'
import { gradeHigherWorse, gradeStatus, THRESHOLDS } from './linkQuality'

export interface LinkBadgeInfo {
  label: string
  detail?: string
  status: StatStatus
}

export function formatLinkBadge(linkStatus: LinkStatus | null): LinkBadgeInfo {
  if (!linkStatus || linkStatus.state === 'disconnected') {
    return { label: 'Disconnected', status: 'critical' }
  }
  if (linkStatus.state === 'connecting') {
    return { label: 'Connecting…', status: 'warning' }
  }

  const pathLabel = linkStatus.path === 'relayed' ? 'Relayed' : linkStatus.path === 'direct' ? 'Direct' : 'Connected'
  const detailParts = [
    linkStatus.rttMs !== undefined ? `${Math.round(linkStatus.rttMs)} ms` : undefined,
    linkStatus.ipVersion ? `IPv${linkStatus.ipVersion}` : undefined,
  ].filter(Boolean)
  // Latency only: this tile is about the connection; the video badge and
  // the link quality panel cover the feed itself.
  const latency = gradeStatus(gradeHigherWorse(linkStatus.rttMs, THRESHOLDS.rttMs))
  const status: StatStatus = linkStatus.state === 'degraded' ? 'warning' : (latency ?? 'good')

  return { label: pathLabel, detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined, status }
}
