import { useEffect, useState } from 'react'
import { Video } from 'lucide-react'
import { useVehicleStore, useVehicleStoreApi } from '../../app/store-hooks'

/** How long a refused switch's message stays up. */
const NOTICE_MS = 4000

/**
 * Which camera streams down the one live video link (ADR-0029): one button
 * per camera the drone reports, the one being sent highlighted. A switch is
 * shown pending until the drone reports the new camera, and a refusal says
 * why. Nothing at all when the drone doesn't report its cameras.
 */
export function CameraSwitcher() {
  const store = useVehicleStoreApi()
  const video = useVehicleStore((s) => s.vehicleState?.video)
  const [pending, setPending] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Pending until the drone says it's sending the new camera.
  const active = video?.activeCameraId
  useEffect(() => {
    if (pending && pending === active) setPending(null)
  }, [pending, active])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  if (!video || video.cameras.length < 2) return null

  async function select(cameraId: string) {
    if (cameraId === active || pending) return
    setPending(cameraId)
    setNotice(null)
    const result = await store.getState().send({ type: 'video.source', cameraId })
    if (!result.ok) {
      setPending(null)
      setNotice(`Camera didn't switch: ${result.detail ?? result.reason}`)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="glass-panel flex items-center overflow-hidden p-0.5" role="group" aria-label="Camera">
        <Video size={13} className="mx-1.5 shrink-0" style={{ color: 'var(--primary)' }} aria-hidden />
        {video.cameras.map((camera) => {
          const isActive = camera.id === active
          const isPending = camera.id === pending
          return (
            <button
              key={camera.id}
              type="button"
              onClick={() => void select(camera.id)}
              aria-pressed={isActive}
              aria-busy={isPending}
              title={camera.kind === 'gimbal' ? 'The gimbal camera' : `The ${camera.name.toLowerCase()} camera`}
              className={`hud-label rounded-md px-2.5 py-1 transition ${isPending ? 'animate-pulse' : ''}`}
              style={isActive || isPending ? { color: 'var(--primary)', background: 'var(--accent)' } : undefined}
            >
              {camera.name}
            </button>
          )
        })}
      </div>
      {notice && (
        <div role="alert" className="glass-panel px-2.5 py-1.5 text-[0.6875rem]" style={{ color: 'var(--status-warning)' }}>
          {notice}
        </div>
      )}
    </div>
  )
}
