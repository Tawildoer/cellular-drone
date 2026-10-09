import { ShieldAlert, Unplug } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useVehicleStore } from '../../app/store-hooks'
import type { StatStatus } from '../../components/StatTile'
import type { FailsafeFlags } from '../../domain'
import { useTelemetryAge } from './telemetryAge'

function Banner({ status, icon: Icon, children }: { status: StatStatus; icon: LucideIcon; children: ReactNode }) {
  const color = `var(--status-${status})`
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-lg border px-3 py-2"
      style={{ borderColor: color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}
    >
      <Icon size={16} style={{ color }} aria-hidden className="shrink-0" />
      <span className="hud-value" style={{ color, textShadow: 'none' }}>
        {children}
      </span>
    </div>
  )
}

/**
 * Shown when telemetry stops arriving: everything on screen is then the last
 * thing the drone said, not what it's doing now. The aircraft flies on
 * regardless (ADR-0020); this is about trusting the display.
 */
export function TelemetryStaleBanner() {
  const { ageMs, stale } = useTelemetryAge()
  if (!stale || ageMs === null) return null
  return (
    <Banner status="serious" icon={Unplug}>
      No telemetry for {Math.floor(ageMs / 1000)} s: showing the last known state. The aircraft carries on with its mission.
    </Banner>
  )
}

const FAILSAFE_TEXT: Record<keyof FailsafeFlags, { text: string; status: StatStatus }> = {
  battery: { text: 'Battery failsafe: the flight controller is acting on its battery settings', status: 'critical' },
  geofence: { text: 'Geofence breach: the flight controller is acting on its fence settings', status: 'critical' },
  // Normal beyond radio range; in AUTO the mission continues (ADR-0008).
  rc: { text: 'RC link lost: in AUTO the mission continues', status: 'warning' },
  gcs: { text: 'Ground-station failsafe active', status: 'warning' },
}

/** One banner per active flight-controller failsafe, worst first. The event
 * log still records when each started and ended. */
export function FailsafeBanners() {
  const failsafe = useVehicleStore((s) => s.vehicleState?.failsafe)
  if (!failsafe) return null
  const active = (Object.keys(FAILSAFE_TEXT) as (keyof FailsafeFlags)[]).filter((flag) => failsafe[flag])
  if (active.length === 0) return null
  return (
    <>
      {active.map((flag) => (
        <Banner key={flag} status={FAILSAFE_TEXT[flag].status} icon={ShieldAlert}>
          {FAILSAFE_TEXT[flag].text}
        </Banner>
      ))}
    </>
  )
}
