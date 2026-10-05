import { useEffect, useRef } from 'react'
import { useVehicleStore } from '../../app/store-hooks'

/** Fills whatever box it's given — same contract as FlightMap (see there). */
export function VideoPanel() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoStream = useVehicleStore((s) => s.videoStream)

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
    </div>
  )
}
