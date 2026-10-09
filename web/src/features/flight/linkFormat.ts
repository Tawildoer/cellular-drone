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
    return { label: 'No link', status: 'critical' }
  }
  if (linkStatus.state === 'connecting') {
    return { label: 'Linking', status: 'warning' }
  }

  const pathLabel = linkStatus.path === 'relayed' ? 'Relayed' : linkStatus.path === 'direct' ? 'Direct' : 'Linked'
  // Latency only: the top bar's tile has a fixed width. The IP version and
  // the rest are in the menu's Link quality section.
  const detailParts = [linkStatus.rttMs !== undefined ? `${Math.round(linkStatus.rttMs)} ms` : undefined].filter(Boolean)
  // Latency only: this tile is about the connection; the video badge and
  // the link quality panel cover the feed itself.
  const latency = gradeStatus(gradeHigherWorse(linkStatus.rttMs, THRESHOLDS.rttMs))
  const status: StatStatus = linkStatus.state === 'degraded' ? 'warning' : (latency ?? 'good')

  return { label: pathLabel, detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined, status }
}
