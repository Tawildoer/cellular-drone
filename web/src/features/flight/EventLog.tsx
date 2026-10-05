import { useVehicleStore } from '../../app/store-hooks'
import { eventStatus, formatEventMessage, formatEventTime } from './eventFormat'

export function EventLog() {
  const events = useVehicleStore((s) => s.events)
  const newestFirst = [...events].reverse()

  return (
    <div className="glass-panel flex h-full w-full flex-col overflow-hidden">
      {/* pl-10 clears the close button EventLogPopout overlays at top-left,
          in the same spot as the toggle that opened this panel. */}
      <div className="flex h-9 items-center border-b border-border/60 pl-10 pr-2.5">
        <span className="hud-label">Event log</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-1.5">
        {newestFirst.length === 0 ? (
          <span className="hud-label">No events yet</span>
        ) : (
          <ul className="flex flex-col gap-2">
            {newestFirst.map((event, i) => {
              const status = eventStatus(event)
              return (
                <li key={`${event.ts}-${i}`} className="flex items-start gap-2">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: status ? `var(--status-${status})` : 'var(--text-dim)' }}
                    aria-hidden
                  />
                  <div className="flex flex-col">
                    <span className="hud-label text-[0.625rem]">{formatEventTime(event.ts)}</span>
                    <span
                      className="text-sm"
                      style={{ color: status ? `var(--status-${status})` : 'var(--foreground)' }}
                    >
                      {formatEventMessage(event)}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
