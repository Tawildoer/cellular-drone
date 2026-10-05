import { useState } from 'react'
import { useVehicleStore } from '../../app/store-hooks'
import { HoldToConfirmButton } from '../../components/HoldToConfirmButton'
import { Button } from '../../components/ui/button'
import { evaluatePreflight, type Command, type Mission } from '../../domain'

export function CommandBar({ mission }: { mission: Mission | null }) {
  const vehicleState = useVehicleStore((s) => s.vehicleState)
  const send = useVehicleStore((s) => s.send)
  const [lastError, setLastError] = useState<string | null>(null)

  async function sendCommand(cmd: Command) {
    const result = await send(cmd)
    setLastError(result.ok ? null : `${result.reason}${result.detail ? ` — ${result.detail}` : ''}`)
  }

  if (!vehicleState) {
    return (
      <div className="glass-panel px-3 py-3">
        <span className="hud-label">Command bar — waiting for telemetry…</span>
      </div>
    )
  }

  const checklist = evaluatePreflight(vehicleState, mission)
  const armed = vehicleState.armed
  const canPause = vehicleState.flightMode === 'AUTO'
  const canResume = vehicleState.flightMode === 'QLOITER' || vehicleState.flightMode === 'LOITER'

  return (
    <div className="glass-panel flex flex-wrap items-center gap-1.5 px-2.5 py-2">
      <HoldToConfirmButton
        onConfirm={() => sendCommand({ type: armed ? 'disarm' : 'arm' })}
        disabled={!armed && !checklist.ready}
        variant={armed ? 'default' : 'destructive'}
      >
        {armed ? 'Hold to disarm' : 'Hold to arm'}
      </HoldToConfirmButton>

      <HoldToConfirmButton
        onConfirm={() => sendCommand({ type: 'mission.start' })}
        disabled={!armed || !checklist.ready}
      >
        Hold to start mission
      </HoldToConfirmButton>

      <Button type="button" variant="secondary" size="sm" disabled={!canPause} onClick={() => sendCommand({ type: 'mode.pause' })}>
        Pause
      </Button>
      <Button type="button" variant="secondary" size="sm" disabled={!canResume} onClick={() => sendCommand({ type: 'mode.resume' })}>
        Resume
      </Button>

      <HoldToConfirmButton onConfirm={() => sendCommand({ type: 'mode.rtl' })} disabled={vehicleState.landed}>
        Hold for RTL
      </HoldToConfirmButton>

      <HoldToConfirmButton
        onConfirm={() => sendCommand({ type: 'mode.qland' })}
        disabled={vehicleState.landed}
        variant="destructive"
      >
        Hold for QLAND
      </HoldToConfirmButton>

      {lastError && (
        <span role="alert" className="hud-label" style={{ color: 'var(--status-critical)' }}>
          {lastError}
        </span>
      )}
    </div>
  )
}
