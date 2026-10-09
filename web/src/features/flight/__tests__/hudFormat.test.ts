import { describe, expect, it } from 'vitest'
import {
  batteryIcon,
  batteryStatus,
  formatHeadingDeg,
  gpsFixLabel,
  gpsStatus,
  vtolStateLabel,
} from '../hudFormat'

describe('formatHeadingDeg', () => {
  it('pads to three digits', () => {
    expect(formatHeadingDeg(5)).toBe('005°')
  })

  it('normalizes negative angles', () => {
    expect(formatHeadingDeg(-10)).toBe('350°')
  })

  it('normalizes angles past 360', () => {
    expect(formatHeadingDeg(370)).toBe('010°')
  })
})

describe('batteryStatus', () => {
  it('is critical below 20%', () => {
    expect(batteryStatus(19)).toBe('critical')
  })

  it('is warning between 20% and 40%', () => {
    expect(batteryStatus(25)).toBe('warning')
  })

  it('is good at or above 40%', () => {
    expect(batteryStatus(40)).toBe('good')
    expect(batteryStatus(100)).toBe('good')
  })
})

describe('batteryIcon', () => {
  it('picks a distinct icon per band', () => {
    const icons = new Set([batteryIcon(5), batteryIcon(25), batteryIcon(50), batteryIcon(90)])
    expect(icons.size).toBe(4)
  })
})

describe('gpsFixLabel / gpsStatus', () => {
  it('maps every fix type to a label and a status', () => {
    expect(gpsFixLabel('none')).toBe('No fix')
    expect(gpsStatus('none')).toBe('critical')

    expect(gpsFixLabel('fix2d')).toBe('2D fix')
    expect(gpsStatus('fix2d')).toBe('warning')

    expect(gpsFixLabel('fix3d')).toBe('3D fix')
    expect(gpsStatus('fix3d')).toBe('good')

    expect(gpsFixLabel('rtk')).toBe('RTK')
    expect(gpsStatus('rtk')).toBe('good')
  })
})

describe('vtolStateLabel', () => {
  it('maps every vtol state', () => {
    expect(vtolStateLabel('mc')).toBe('MC')
    expect(vtolStateLabel('fw')).toBe('FW')
    expect(vtolStateLabel('transition')).toBe('Trans')
  })
})
