import { describe, expect, it } from 'vitest'
import type { Mission } from '../../domain'
import { sameMissionItems } from '../describe'
import { translateMission } from '../translate'
import { toWaypointsFile, waypointsFileName } from '../waypointsFile'

const mission: Mission = {
  id: 'm',
  name: 'Test',
  items: [
    { type: 'vtolTakeoff', altM: 40 },
    { type: 'waypoint', lat: -37.86, lon: 145.063, altM: 60 },
    { type: 'returnToLaunch' },
  ],
  createdAt: 0,
  updatedAt: 0,
}
const home = { lat: -37.861, lon: 145.062, altAmslM: 50 }

describe('toWaypointsFile', () => {
  it('writes the QGC WPL 110 format with home as row 0', () => {
    const lines = toWaypointsFile(translateMission(mission, home).items).trimEnd().split('\n')

    expect(lines[0]).toBe('QGC WPL 110')
    expect(lines).toHaveLength(5)
    expect(lines[1]!.split('\t')).toEqual([
      '0', '1', '0', '16',
      '0.00000000', '0.00000000', '0.00000000', '0.00000000',
      '-37.86100000', '145.06200000', '50.000000', '1',
    ])
    expect(lines[2]!.split('\t').slice(0, 4)).toEqual(['1', '0', '3', '84'])
    expect(lines[3]!.split('\t').slice(8, 11)).toEqual(['-37.86000000', '145.06300000', '60.000000'])
    expect(lines[4]!.split('\t').slice(0, 4)).toEqual(['3', '0', '3', '20'])
  })

  it('makes a safe file name', () => {
    expect(waypointsFileName('  Demo patrol #2 ')).toBe('demo-patrol-2.waypoints')
    expect(waypointsFileName('***')).toBe('mission.waypoints')
  })
})

describe('sameMissionItems', () => {
  const planned = translateMission(mission, home).items

  it('ignores ArduPilot storage rounding and a moved home', () => {
    const readback = planned.map((item) => ({
      ...item,
      lat: item.seq === 0 ? item.lat + 0.01 : item.lat + 1e-7,
      altM: item.altM + 0.004,
    }))
    expect(sameMissionItems(planned, readback)).toBe(true)
  })

  it('spots a changed item', () => {
    const readback = planned.map((item) => (item.seq === 2 ? { ...item, altM: 80 } : item))
    expect(sameMissionItems(planned, readback)).toBe(false)
  })

  it('spots a missing item', () => {
    expect(sameMissionItems(planned, planned.slice(0, -1))).toBe(false)
  })
})
