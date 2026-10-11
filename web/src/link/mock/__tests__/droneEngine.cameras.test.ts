import { describe, expect, it } from 'vitest'
import { DroneEngine, MOCK_CAMERAS } from '../droneEngine'

describe('mock cameras (ADR-0029)', () => {
  it('reports its cameras, streaming the gimbal camera to begin with', () => {
    const engine = new DroneEngine()
    expect(engine.buildVehicleState().video).toEqual({ cameras: MOCK_CAMERAS, activeCameraId: 'gimbal' })
  })

  it('switches to a camera it has, and refuses one it hasn't', () => {
    const engine = new DroneEngine()
    expect(engine.applyCommand({ type: 'video.source', cameraId: 'belly' })).toEqual({ ok: true })
    expect(engine.buildVehicleState().video?.activeCameraId).toBe('belly')
    expect(engine.applyCommand({ type: 'video.source', cameraId: 'tail' })).toMatchObject({ ok: false, reason: 'rejected_by_vehicle' })
    expect(engine.buildVehicleState().video?.activeCameraId).toBe('belly')
  })

  it('switches while the RC pilot has control: camera only', () => {
    const engine = new DroneEngine()
    engine.setFaultConfig({ rcOverrideActive: true })
    expect(engine.applyCommand({ type: 'video.source', cameraId: 'nose' })).toEqual({ ok: true })
  })
})
