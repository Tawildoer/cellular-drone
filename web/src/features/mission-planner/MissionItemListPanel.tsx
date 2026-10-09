import { Orbit, Trash2 } from 'lucide-react'
import { itemPosition, MIN_LOITER_RADIUS_M, missionItemLabel, type Mission, type MissionItem } from '../../domain'
import { Button } from '../../components/ui/button'
import {
  defaultLoiterUntilUtcMinuteOfDay,
  localTimeToUtcMinuteOfDay,
  removeItemAt,
  setEndingLandAtLastWaypoint,
  setEndingReturnToLaunch,
  setItemLoiter,
  setLoiterLaps,
  setLoiterUntil,
  updateItemAltitude,
  updateItemRadius,
  utcMinuteOfDayToLocalTime,
} from './missionEdit'

function hasAltitude(item: MissionItem): item is Extract<MissionItem, { altM: number }> {
  return item.type === 'vtolTakeoff' || item.type === 'waypoint' || item.type === 'loiter'
}

const SEGMENT_ACTIVE_STYLE = { color: 'var(--primary)', background: 'var(--accent)' }

/** How a loiter decides it's done: a lap count, or a local time of day to
 * keep lapping until (stored as UTC, see domain/mission.ts). */
function LoiterEndControls({
  item,
  index,
  items,
  onChangeItems,
}: {
  item: Extract<MissionItem, { type: 'loiter' }>
  index: number
  items: MissionItem[]
  onChangeItems: (items: MissionItem[]) => void
}) {
  const clockMode = item.untilUtcMinuteOfDay !== undefined
  const laps = item.turns ?? 1

  return (
    <div className="flex items-center gap-2 pl-7">
      <div className="flex overflow-hidden rounded border border-border/60">
        <button
          type="button"
          onClick={() => onChangeItems(setLoiterLaps(items, index, laps))}
          aria-pressed={!clockMode}
          className="hud-label px-1.5 py-0.5 transition"
          style={!clockMode ? SEGMENT_ACTIVE_STYLE : undefined}
        >
          Laps
        </button>
        <button
          type="button"
          onClick={() => {
            if (!clockMode) onChangeItems(setLoiterUntil(items, index, defaultLoiterUntilUtcMinuteOfDay()))
          }}
          aria-pressed={clockMode}
          className="hud-label px-1.5 py-0.5 transition"
          style={clockMode ? SEGMENT_ACTIVE_STYLE : undefined}
        >
          Until
        </button>
      </div>
      {clockMode ? (
        <input
          type="time"
          value={utcMinuteOfDayToLocalTime(item.untilUtcMinuteOfDay ?? 0)}
          onChange={(e) => {
            const utcMinute = localTimeToUtcMinuteOfDay(e.target.value)
            if (utcMinute !== null) onChangeItems(setLoiterUntil(items, index, utcMinute))
          }}
          className="rounded border border-border/60 bg-transparent px-1.5 py-0.5 text-xs"
          aria-label={`Loiter item ${index + 1} end time`}
        />
      ) : (
        <input
          type="number"
          min={1}
          step={1}
          value={laps}
          onChange={(e) => onChangeItems(setLoiterLaps(items, index, Number(e.target.value)))}
          onBlur={() => {
            if (!(Number.isInteger(laps) && laps >= 1)) onChangeItems(setLoiterLaps(items, index, Math.max(1, Math.round(laps) || 1)))
          }}
          className="w-14 rounded border border-border/60 bg-transparent px-1.5 py-0.5 text-right text-xs"
          aria-label={`Loiter item ${index + 1} laps`}
        />
      )}
    </div>
  )
}

export interface MissionItemListPanelProps {
  mission: Mission
  onChangeItems: (items: MissionItem[]) => void
  onRename: (name: string) => void
  onSave: () => void
}

export function MissionItemListPanel({ mission, onChangeItems, onRename, onSave }: MissionItemListPanelProps) {
  const items = mission.items
  const lastItem = items[items.length - 1]
  const endingIsLand = lastItem?.type === 'vtolLand'
  const precedingItem = items[items.length - 2]
  const canLandAtLastWaypoint = items.length >= 2 && !!precedingItem && itemPosition(precedingItem) !== null

  return (
    <div className="glass-panel flex max-h-[42vh] w-80 flex-col overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-border/60 px-2.5 py-1.5">
        <input
          type="text"
          value={mission.name}
          onChange={(e) => onRename(e.target.value)}
          aria-label="Mission name"
          placeholder="Mission name"
          className="hud-label min-w-0 flex-1 bg-transparent px-0.5 py-0.5 outline-none focus:ring-1 focus:ring-primary"
          style={{ color: 'var(--foreground)' }}
        />
        <Button type="button" size="sm" variant="secondary" onClick={onSave}>
          Save
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-1.5">
        {items.length === 0 ? (
          <span className="hud-label">No items yet</span>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {items.map((item, index) => {
              const isTakeoff = index === 0
              const isEnding = index === items.length - 1
              const canRemove = !isTakeoff && !isEnding
              // Only a plain waypoint or an existing loiter can toggle — not
              // takeoff (no position) or the ending item (RTL/land-here).
              const canToggleLoiter = canRemove && (item.type === 'waypoint' || item.type === 'loiter')
              const isLoiter = item.type === 'loiter'

              return (
                <li key={index} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="hud-label w-5 shrink-0">{index + 1}</span>
                    <span className="flex-1 text-xs">{missionItemLabel(item)}</span>
                    {hasAltitude(item) && (
                      <input
                        type="number"
                        value={item.altM}
                        onChange={(e) => onChangeItems(updateItemAltitude(items, index, Number(e.target.value)))}
                        className="w-14 rounded border border-border/60 bg-transparent px-1.5 py-0.5 text-right text-xs"
                        aria-label={`${missionItemLabel(item)} altitude, meters`}
                      />
                    )}
                    {canToggleLoiter && (
                      <button
                        type="button"
                        onClick={() => onChangeItems(setItemLoiter(items, index, !isLoiter))}
                        aria-pressed={isLoiter}
                        aria-label={isLoiter ? `Make item ${index + 1} a plain waypoint` : `Make item ${index + 1} a loiter point`}
                        className="shrink-0 rounded p-0.5 transition hover:opacity-70"
                        style={isLoiter ? { color: 'var(--primary)', background: 'var(--accent)' } : undefined}
                      >
                        <Orbit size={12} aria-hidden />
                      </button>
                    )}
                    {canRemove && (
                      <button
                        type="button"
                        onClick={() => onChangeItems(removeItemAt(items, index))}
                        aria-label={`Remove item ${index + 1}`}
                        className="shrink-0 transition hover:opacity-70"
                      >
                        <Trash2 size={12} style={{ color: 'var(--status-critical)' }} aria-hidden />
                      </button>
                    )}
                  </div>
                  {isLoiter && (
                    <div className="flex items-center gap-2 pl-7">
                      <span className="hud-label">Radius</span>
                      <input
                        type="number"
                        min={MIN_LOITER_RADIUS_M}
                        value={item.radiusM}
                        onChange={(e) => onChangeItems(updateItemRadius(items, index, Number(e.target.value)))}
                        onBlur={() => {
                          if (!(item.radiusM >= MIN_LOITER_RADIUS_M)) onChangeItems(updateItemRadius(items, index, MIN_LOITER_RADIUS_M))
                        }}
                        className="w-14 rounded border border-border/60 bg-transparent px-1.5 py-0.5 text-right text-xs"
                        aria-label={`Loiter item ${index + 1} radius, meters`}
                      />
                      <span className="hud-label">m</span>
                    </div>
                  )}
                  {isLoiter && <LoiterEndControls item={item} index={index} items={items} onChangeItems={onChangeItems} />}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t border-border/60 px-2.5 py-1.5">
        <span className="hud-label">Ending</span>
        <button
          type="button"
          onClick={() => onChangeItems(setEndingReturnToLaunch(items))}
          aria-pressed={!endingIsLand}
          className="hud-label rounded px-2 py-1 transition"
          style={!endingIsLand ? { color: 'var(--primary)', background: 'var(--accent)' } : undefined}
        >
          RTL
        </button>
        <button
          type="button"
          onClick={() => onChangeItems(setEndingLandAtLastWaypoint(items))}
          aria-pressed={endingIsLand}
          disabled={!canLandAtLastWaypoint}
          className="hud-label rounded px-2 py-1 transition disabled:opacity-40"
          style={endingIsLand ? { color: 'var(--primary)', background: 'var(--accent)' } : undefined}
        >
          Land here
        </button>
      </div>
    </div>
  )
}
