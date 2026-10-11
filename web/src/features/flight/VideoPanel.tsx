import { useEffect, useRef } from 'react'
import { useVehicleStore } from '../../app/store-hooks'
import { CameraSwitcher } from './CameraSwitcher'

/** Fills whatever box it's given — same contract as FlightMap (see there).
 * `showControls` false (the small picture-in-picture tile) hides the camera
 * switcher; the tile names the camera instead. */
export function VideoPanel({ showControls = true }: { showControls?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoStream = useVehicleStore((s) => s.videoStream)
  const cameraName = useVehicleStore((s) => {
    const video = s.vehicleState?.video
    return video?.cameras.find((c) => c.id === video.activeCameraId)?.name ?? null
  })

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = videoStream
  }, [videoStream])

  return (
    <div className="absolute inset-0 bg-black">
      <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
      {!videoStream && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="hud-label">No video</span>
        </div>
      )}
      {/* Where the map's controls sit when the map is full size. */}
      {showControls && (
        <div className="absolute right-4 top-14 z-10">
          <CameraSwitcher />
        </div>
      )}
      {!showControls && cameraName && (
        <span className="hud-label absolute left-2 top-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[0.5625rem]">{cameraName}</span>
      )}
    </div>
  )
}
