import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Mission, MissionItem } from '../../../domain'
import { insertWaypoint, setItemLoiter, setLoiterUntil, skeletonItems } from '../missionEdit'
import { MissionItemListPanel } from '../MissionItemListPanel'

function missionWith(items: MissionItem[]): Mission {
  return { id: 'm1', name: 'test mission', items, createdAt: 0, updatedAt: 0 }
}

describe('MissionItemListPanel', () => {
  it('renders every item with its ordinal and type', () => {
    const items = insertWaypoint(skeletonItems(), { lat: 1, lon: 2 })
    render(<MissionItemListPanel mission={missionWith(items)} onChangeItems={vi.fn()} onRename={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByText('Takeoff')).toBeInTheDocument()
    expect(screen.getByText('Waypoint')).toBeInTheDocument()
    expect(screen.getByText('Return to launch')).toBeInTheDocument()
  })

  it('does not offer a remove button for takeoff or the ending item', () => {
    render(<MissionItemListPanel mission={missionWith(skeletonItems())} onChangeItems={vi.fn()} onRename={vi.fn()} onSave={vi.fn()} />)
    expect(screen.queryByLabelText(/remove item/i)).not.toBeInTheDocument()
  })

  it('removes a waypoint via its remove button', () => {
    const items = insertWaypoint(skeletonItems(), { lat: 1, lon: 2 })
    const onChangeItems = vi.fn()
    render(<MissionItemListPanel mission={missionWith(items)} onChangeItems={onChangeItems} onRename={vi.fn()} onSave={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Remove item 2'))
    expect(onChangeItems).toHaveBeenCalledWith([items[0], items[2]])
  })

  it('edits a waypoint altitude', () => {
    const items = insertWaypoint(skeletonItems(), { lat: 1, lon: 2 })
    const onChangeItems = vi.fn()
    render(<MissionItemListPanel mission={missionWith(items)} onChangeItems={onChangeItems} onRename={vi.fn()} onSave={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Waypoint altitude, meters'), { target: { value: '120' } })
    expect(onChangeItems.mock.calls[0]?.[0][1]).toMatchObject({ altM: 120 })
  })

  it('switches the ending to land at the last waypoint and back', () => {
    const items = insertWaypoint(skeletonItems(), { lat: 1, lon: 2 })
    const onChangeItems = vi.fn()
    render(<MissionItemListPanel mission={missionWith(items)} onChangeItems={onChangeItems} onRename={vi.fn()} onSave={vi.fn()} />)
    fireEvent.click(screen.getByText('Land here'))
    expect(onChangeItems.mock.calls[0]?.[0].at(-1)).toMatchObject({ type: 'vtolLand', lat: 1, lon: 2 })
  })

  it('disables "Land here" when there is no waypoint to land at', () => {
    render(<MissionItemListPanel mission={missionWith(skeletonItems())} onChangeItems={vi.fn()} onRename={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByText('Land here')).toBeDisabled()
  })

  it('calls onRename when the name field is edited', () => {
    const onRename = vi.fn()
    render(<MissionItemListPanel mission={missionWith(skeletonItems())} onChangeItems={vi.fn()} onRename={onRename} onSave={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Mission name'), { target: { value: 'Patrol Route' } })
    expect(onRename).toHaveBeenCalledWith('Patrol Route')
  })

  it('shows the mission current name in the name field', () => {
    render(<MissionItemListPanel mission={missionWith(skeletonItems())} onChangeItems={vi.fn()} onRename={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByLabelText('Mission name')).toHaveValue('test mission')
  })

  it('calls onSave when the Save button is clicked', () => {
    const onSave = vi.fn()
    render(<MissionItemListPanel mission={missionWith(skeletonItems())} onChangeItems={vi.fn()} onRename={vi.fn()} onSave={onSave} />)
    fireEvent.click(screen.getByText('Save'))
    expect(onSave).toHaveBeenCalled()
  })

  it('does not offer a loiter toggle for takeoff or the ending item', () => {
    render(<MissionItemListPanel mission={missionWith(skeletonItems())} onChangeItems={vi.fn()} onRename={vi.fn()} onSave={vi.fn()} />)
    expect(screen.queryByLabelText(/loiter point/i)).not.toBeInTheDocument()
  })

  it('turns a waypoint into a loiter, defaulting its radius to the 60m minimum', () => {
    const items = insertWaypoint(skeletonItems(), { lat: 1, lon: 2 })
    const onChangeItems = vi.fn()
    render(<MissionItemListPanel mission={missionWith(items)} onChangeItems={onChangeItems} onRename={vi.fn()} onSave={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Make item 2 a loiter point'))
    expect(onChangeItems.mock.calls[0]?.[0][1]).toMatchObject({ type: 'loiter', radiusM: 60 })
  })

  it('raises a below-minimum loiter radius to 60m when the field loses focus', () => {
    const loitered = setItemLoiter(insertWaypoint(skeletonItems(), { lat: 1, lon: 2 }), 1, true)
    const items = loitered.map((item) => (item.type === 'loiter' ? { ...item, radiusM: 30 } : item))
    const onChangeItems = vi.fn()
    render(<MissionItemListPanel mission={missionWith(items)} onChangeItems={onChangeItems} onRename={vi.fn()} onSave={vi.fn()} />)
    fireEvent.blur(screen.getByLabelText('Loiter item 2 radius, meters'))
    expect(onChangeItems.mock.calls[0]?.[0][1]).toMatchObject({ radiusM: 60 })
  })

  it('shows a radius input once an item is a loiter, and edits it', () => {
    const items = setItemLoiter(insertWaypoint(skeletonItems(), { lat: 1, lon: 2 }), 1, true)
    const onChangeItems = vi.fn()
    render(<MissionItemListPanel mission={missionWith(items)} onChangeItems={onChangeItems} onRename={vi.fn()} onSave={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Loiter item 2 radius, meters'), { target: { value: '90' } })
    expect(onChangeItems.mock.calls[0]?.[0][1]).toMatchObject({ radiusM: 90 })
  })

  it('switches a loiter to clock mode and edits its lap count in laps mode', () => {
    const items = setItemLoiter(insertWaypoint(skeletonItems(), { lat: 1, lon: 2 }), 1, true)
    const onChangeItems = vi.fn()
    render(<MissionItemListPanel mission={missionWith(items)} onChangeItems={onChangeItems} onRename={vi.fn()} onSave={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Loiter item 2 laps'), { target: { value: '3' } })
    expect(onChangeItems.mock.calls[0]?.[0][1]).toMatchObject({ turns: 3 })

    fireEvent.click(screen.getByText('Until'))
    const clockItem = onChangeItems.mock.calls[1]?.[0][1]
    expect(clockItem.untilUtcMinuteOfDay).toEqual(expect.any(Number))
    expect(clockItem).not.toHaveProperty('turns')
  })

  it('shows an end-time field for a loiter in clock mode', () => {
    const items = setLoiterUntil(setItemLoiter(insertWaypoint(skeletonItems(), { lat: 1, lon: 2 }), 1, true), 1, 870)
    render(<MissionItemListPanel mission={missionWith(items)} onChangeItems={vi.fn()} onRename={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByLabelText('Loiter item 2 end time')).toBeInTheDocument()
    expect(screen.queryByLabelText('Loiter item 2 laps')).not.toBeInTheDocument()
  })

  it('turns a loiter back into a plain waypoint', () => {
    const items = setItemLoiter(insertWaypoint(skeletonItems(), { lat: 1, lon: 2 }), 1, true)
    const onChangeItems = vi.fn()
    render(<MissionItemListPanel mission={missionWith(items)} onChangeItems={onChangeItems} onRename={vi.fn()} onSave={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Make item 2 a plain waypoint'))
    expect(onChangeItems.mock.calls[0]?.[0][1]).toMatchObject({ type: 'waypoint' })
  })
})
