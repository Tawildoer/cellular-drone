import { useEffect, useState, type ReactNode } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { useVehicleStore } from '../../app/store-hooks'
import { HoldToConfirmButton } from '../../components/HoldToConfirmButton'
import { evaluatePreflight, type Command, type Mission } from '../../domain'

const COMMAND_LABEL: Record<Command['type'], string> = {
  arm: 'Arm',
  disarm: 'Disarm',
  'mission.start': 'Start mission',
  'mode.pause': 'Pause',
  'mode.resume': 'Resume',
  'mode.rtl': 'RTL',
  'mode.qland': 'QLAND',
  'gimbal.lock': 'Gimbal lock',
  'gimbal.release': 'Gimbal release',
  'freefly.start': 'Free fly',
  'freefly.waypoint': 'Free-fly waypoint',
  'freefly.remove': 'Remove waypoint',
  'freefly.loiter': 'Loiter',
  'video.config': 'Video settings',
}

/** Each command is a tile, like the top bar's metrics. */
const TILE = 'h-8 whitespace-nowrap rounded-lg bg-secondary glass-tile px-3'

/** How long "accepted" stays up after a command goes through. */
const ACCEPTED_MS = 3_000

/** Hovering a disabled button says why (the title is on a wrapper: a
 * disabled button itself gets no pointer events). */
function Why({ reason, children }: { reason: string | null; children: ReactNode }) {
  return <span title={reason ?? undefined}>{children}</span>
}

type Feedback = { kind: 'pending'; type: Command['type'] } | { kind: 'accepted'; type: Command['type'] } | { kind: 'error'; text: string }

export function CommandBar({ mission }: { mission: Mission | null }) {
  const vehicleState = useVehicleStore((s) => s.vehicleState)
  const send = useVehicleStore((s) => s.send)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  // "Accepted" fades out on its own; pending and errors stay until replaced.
  useEffect(() => {
    if (feedback?.kind !== 'accepted') return
    const timer = setTimeout(() => setFeedback((f) => (f === feedback ? null : f)), ACCEPTED_MS)
    return () => clearTimeout(timer)
  }, [feedback])

  async function sendCommand(cmd: Command) {
    // Commands can take seconds: the agent retries over MAVLink.
    setFeedback({ kind: 'pending', type: cmd.type })
    const result = await send(cmd)
    setFeedback(
      result.ok
        ? { kind: 'accepted', type: cmd.type }
        : { kind: 'error', text: `${COMMAND_LABEL[cmd.type]}: ${result.reason}${result.detail ? ` — ${result.detail}` : ''}` },
    )
  }

  if (!vehicleState) {
    return (
      <div className="flex h-8 items-center rounded-lg bg-secondary glass-tile px-3">
        <span className="hud-label">Commands — waiting for telemetry…</span>
      </div>
    )
  }

  const checklist = evaluatePreflight(vehicleState, mission)
  const failing = checklist.items.filter((item) => !item.passed).map((item) => item.label)
  const preflightReason = failing.length > 0 ? `Preflight: ${failing.join('; ')}` : null
  const armed = vehicleState.armed
  const mode = vehicleState.flightMode
  const canPause = mode === 'AUTO'
  const canResume = mode === 'QLOITER' || mode === 'LOITER'
  const pendingType = feedback?.kind === 'pending' ? feedback.type : null

  const armReason = !armed ? preflightReason : null
  // mission.start is for the ground (docs/MAVLINK.md); in the air it's Resume.
  const startReason = !armed ? 'Arm first' : !vehicleState.landed ? 'Already flying' : preflightReason
  const pauseReason = canPause ? null : 'Only while flying the mission (AUTO)'
  const resumeReason = canResume ? null : 'Only while paused (LOITER or QLOITER)'
  const landedReason = vehicleState.landed ? 'On the ground' : null

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Why reason={armReason}>
        <HoldToConfirmButton
          className={TILE}
          onConfirm={() => void sendCommand({ type: armed ? 'disarm' : 'arm' })}
          disabled={armReason !== null || pendingType === 'arm' || pendingType === 'disarm'}
          variant={armed ? 'default' : 'destructive'}
        >
          {armed ? 'Hold to disarm' : 'Hold to arm'}
        </HoldToConfirmButton>
      </Why>

      <Why reason={startReason}>
        <HoldToConfirmButton
          className={TILE}
          onConfirm={() => void sendCommand({ type: 'mission.start' })}
          disabled={startReason !== null || pendingType === 'mission.start'}
        >
          Hold to start mission
        </HoldToConfirmButton>
      </Why>

      <Why reason={pauseReason}>
        <button
          type="button"
          className={`${TILE} text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40`}
          disabled={!canPause || pendingType === 'mode.pause'}
          onClick={() => void sendCommand({ type: 'mode.pause' })}
        >
          Pause
        </button>
      </Why>
      <Why reason={resumeReason}>
        <button
          type="button"
          className={`${TILE} text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40`}
          disabled={!canResume || pendingType === 'mode.resume'}
          onClick={() => void sendCommand({ type: 'mode.resume' })}
        >
          Resume
        </button>
      </Why>

      <Why reason={landedReason}>
        <HoldToConfirmButton
          className={TILE}
          onConfirm={() => void sendCommand({ type: 'mode.rtl' })}
          disabled={landedReason !== null || pendingType === 'mode.rtl'}
        >
          Hold for RTL
        </HoldToConfirmButton>
      </Why>

      <Why reason={landedReason}>
        <HoldToConfirmButton
          className={TILE}
          onConfirm={() => void sendCommand({ type: 'mode.qland' })}
          disabled={landedReason !== null || pendingType === 'mode.qland'}
          variant="destructive"
        >
          Hold for QLAND
        </HoldToConfirmButton>
      </Why>

      {feedback?.kind === 'pending' && (
        <span role="status" className="hud-label flex items-center gap-1">
          <Loader2 size={12} className="animate-spin" aria-hidden />
          Sending {COMMAND_LABEL[feedback.type]}…
        </span>
      )}
      {feedback?.kind === 'accepted' && (
        <span role="status" className="hud-label flex items-center gap-1" style={{ color: 'var(--status-good)' }}>
          <CheckCircle2 size={12} aria-hidden />
          {COMMAND_LABEL[feedback.type]} accepted
        </span>
      )}
      {feedback?.kind === 'error' && (
        <span role="alert" className="hud-label min-w-0 truncate" title={feedback.text} style={{ color: 'var(--status-critical)' }}>
          {feedback.text}
        </span>
      )}
    </div>
  )
}
