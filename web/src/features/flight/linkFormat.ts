import type { StatStatus } from '../../components/StatTile'
import type { LinkStatus } from '../../domain'

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
  const detail = linkStatus.rttMs !== undefined ? `${Math.round(linkStatus.rttMs)} ms` : undefined
  const status: StatStatus = linkStatus.state === 'degraded' ? 'warning' : 'good'

  return { label: pathLabel, detail, status }
}
