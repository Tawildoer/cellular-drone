import { Maximize2 } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import type { GeoPoint, Mission } from '../../domain'
import { FlightMap } from './FlightMap'
import { VideoPanel } from './VideoPanel'

type Panel = 'map' | 'video'

const FULL_CLASS = 'relative flex-1'
const TILE_CLASS =
  'glass-panel absolute bottom-3 right-3 z-10 h-28 w-44 cursor-pointer overflow-hidden transition hover:ring-2 hover:ring-primary'

/**
 * Swappable picture-in-picture: one of map/video full-size, the other a small
 * overlay tile — tap the tile to swap. Same layout on every screen size
 * (laptop and phone), per the project's explicit choice to keep one
 * implementation rather than branch by viewport.
 *
 * Both panels stay mounted at all times; only the wrapping div's
 * class/role/tabIndex change. Swapping which one renders into which slot
 * would unmount/remount FlightMap, discarding its live camera position and
 * trail — this way MapLibre and the <video> element both persist across swaps.
 */
export interface FlightPiPProps {
  mission?: Mission | null
  /** The clicked spot, and the terrain's height there (null without terrain). */
  onMapClick?: (point: GeoPoint, groundElevationM: number | null) => void
  /** Given, a double-click calls it instead of zooming (and single clicks
   * wait a moment to be sure they aren't the start of one). */
  onMapDoubleClick?: (point: GeoPoint) => void
  /** Given, mission waypoints are clickable: hovering one shows a pointer,
   * clicking it reports its index and where on screen, instead of a map click. */
  onWaypointClick?: (index: number, screen: { x: number; y: number }) => void
  /** Set true to switch the map into the full-size slot (e.g. entering
   * mission planning, where clicks need to land on the map immediately).
   * Only acts on the transition to true — the user's own tile-tap swaps
   * still apply afterward. */
  focusMap?: boolean
}

export function FlightPiP({ mission = null, onMapClick, onMapDoubleClick, onWaypointClick, focusMap = false }: FlightPiPProps) {
  const [focused, setFocused] = useState<Panel>('map')
  // Adjusting state during render (not in an effect) on the focusMap
  // false->true transition, per https://react.dev/learn/you-might-not-need-an-effect.
  const [prevFocusMap, setPrevFocusMap] = useState(focusMap)
  if (focusMap !== prevFocusMap) {
    setPrevFocusMap(focusMap)
    if (focusMap) setFocused('map')
  }

  function swapTo(panel: Panel) {
    setFocused(panel)
  }

  function handleTileKeyDown(panel: Panel, e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      swapTo(panel)
    }
  }

  return (
    // No browser context menu ("Save image as…") or native image drag on the
    // map canvas or the video: right-drag rotates the map, and clicks and
    // double-clicks there mean something (gimbal lock, free-fly waypoints).
    <div
      className="absolute inset-0 flex overflow-hidden"
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      <Slot panel="map" focused={focused} label="Map" onSwap={swapTo} onKeyDown={handleTileKeyDown}>
        <FlightMap
          mission={mission}
          onMapClick={onMapClick}
          onMapDoubleClick={onMapDoubleClick}
          onWaypointClick={onWaypointClick}
          showControls={focused === 'map'}
        />
      </Slot>
      <Slot panel="video" focused={focused} label="Video" onSwap={swapTo} onKeyDown={handleTileKeyDown}>
        <VideoPanel />
      </Slot>
    </div>
  )
}

interface SlotProps {
  panel: Panel
  focused: Panel
  label: string
  onSwap: (panel: Panel) => void
  onKeyDown: (panel: Panel, e: KeyboardEvent) => void
  children: React.ReactNode
}

function Slot({ panel, focused, label, onSwap, onKeyDown, children }: SlotProps) {
  const isFull = panel === focused

  return (
    <div
      className={isFull ? FULL_CLASS : TILE_CLASS}
      role={isFull ? undefined : 'button'}
      tabIndex={isFull ? undefined : 0}
      aria-label={isFull ? undefined : `Show ${label} full screen`}
      onClick={isFull ? undefined : () => onSwap(panel)}
      onKeyDown={isFull ? undefined : (e) => onKeyDown(panel, e)}
    >
      {children}
      {!isFull && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-2 py-1">
          <span className="hud-label">{label}</span>
          <Maximize2 size={12} style={{ color: 'var(--text-dim)' }} aria-hidden />
        </div>
      )}
    </div>
  )
}
