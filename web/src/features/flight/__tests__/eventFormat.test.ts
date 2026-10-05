import { describe, expect, it } from 'vitest'
import type { VehicleEvent } from '../../../domain'
import { eventStatus, formatEventMessage, formatEventTime } from '../eventFormat'

describe('formatEventMessage', () => {
  it('formats a status event as its own text', () => {
    const e: VehicleEvent = { kind: 'status', text: 'Mission uploaded', ts: 0 }
    expect(formatEventMessage(e)).toBe('Mission uploaded')
  })

  it('formats a failsafe event, active and cleared', () => {
    expect(formatEventMessage({ kind: 'failsafe', flag: 'battery', active: true, ts: 0 })).toBe('BATTERY failsafe ACTIVE')
    expect(formatEventMessage({ kind: 'failsafe', flag: 'battery', active: false, ts: 0 })).toBe('BATTERY failsafe cleared')
  })

  it('formats a modeChanged event', () => {
    expect(formatEventMessage({ kind: 'modeChanged', mode: 'RTL', ts: 0 })).toBe('Mode changed to RTL')
  })

  it('formats an rcOverride event, active and cleared', () => {
    expect(formatEventMessage({ kind: 'rcOverride', active: true, ts: 0 })).toBe('RC override ACTIVE — browser control blocked')
    expect(formatEventMessage({ kind: 'rcOverride', active: false, ts: 0 })).toBe('RC override cleared')
  })
})

describe('eventStatus', () => {
  it('is undefined for status and modeChanged', () => {
    expect(eventStatus({ kind: 'status', text: 'x', ts: 0 })).toBeUndefined()
    expect(eventStatus({ kind: 'modeChanged', mode: 'AUTO', ts: 0 })).toBeUndefined()
  })

  it('is critical/good for failsafe active/cleared', () => {
    expect(eventStatus({ kind: 'failsafe', flag: 'gcs', active: true, ts: 0 })).toBe('critical')
    expect(eventStatus({ kind: 'failsafe', flag: 'gcs', active: false, ts: 0 })).toBe('good')
  })

  it('is warning/good for rcOverride active/cleared', () => {
    expect(eventStatus({ kind: 'rcOverride', active: true, ts: 0 })).toBe('warning')
    expect(eventStatus({ kind: 'rcOverride', active: false, ts: 0 })).toBe('good')
  })
})

describe('formatEventTime', () => {
  it('pads hours, minutes, seconds to two digits', () => {
    const d = new Date()
    d.setHours(1, 2, 3, 0)
    expect(formatEventTime(d.getTime())).toBe('01:02:03')
  })
})
