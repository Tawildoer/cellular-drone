import { Activity, History, ListChecks, Menu, ScrollText, X, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMenuExtras } from '../../app/store-hooks'
import { EventLog } from './EventLog'
import { FlightLogPanel } from './FlightLogPanel'
import { LinkQualityPanel } from './LinkQualityPanel'
import { MissionChooser } from './MissionChooser'

interface Section {
  id: string
  label: string
  icon: LucideIcon
  content: ReactNode
}

const BUILT_IN: Section[] = [
  {
    id: 'missions',
    label: 'Missions',
    icon: ListChecks,
    content: <MissionChooser />,
  },
  { id: 'events', label: 'Event log', icon: ScrollText, content: <EventLog /> },
  {
    id: 'flights',
    label: 'Flight log',
    icon: History,
    content: <FlightLogPanel />,
  },
  {
    id: 'link',
    label: 'Link quality',
    icon: Activity,
    content: <LinkQualityPanel />,
  },
]

/**
 * The flight screen's menu: things the operator looks at now and then (the
 * mission chooser, logs, link detail, the simulator's controls) live here
 * rather than over the map. A ☰ button beside the HUD opens a drawer down
 * the left side; one section is open at a time. Closes with ✕ or Escape.
 */
export function MenuDrawer() {
  const extras = useMenuExtras()
  const sections = [...BUILT_IN, ...extras]
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(BUILT_IN[0]!.id)
  const current = sections.find((s) => s.id === selected) ?? sections[0]!

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls="flight-menu"
        className="glass-panel flex h-9 w-9 shrink-0 items-center justify-center transition hover:ring-2 hover:ring-primary"
      >
        <Menu size={16} style={{ color: 'var(--primary)' }} aria-hidden />
      </button>

      {/* Rendered at the top of the page: inside the HUD's layer, the command
          bar's layer (later on the page) would paint over the drawer. */}
      {open &&
        createPortal(
          <aside
            id="flight-menu"
            aria-label="Menu"
            className="glass-panel pointer-events-auto fixed bottom-3 left-3 top-3 z-40 flex w-80 flex-col overflow-hidden"
          >
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3">
              <span className="hud-label flex-1" style={{ color: 'var(--foreground)' }}>
                Menu
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="transition hover:opacity-70"
              >
                <X size={16} style={{ color: 'var(--primary)' }} aria-hidden />
              </button>
            </div>

            <nav className="flex shrink-0 flex-col gap-0.5 border-b border-border/60 p-1.5" aria-label="Menu sections">
              {sections.map(({ id, label, icon: Icon }) => {
                const active = id === current.id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelected(id)}
                    aria-current={active ? 'page' : undefined}
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition hover:bg-white/5"
                    style={
                      active
                        ? {
                            color: 'var(--primary)',
                            background: 'var(--accent)',
                          }
                        : { color: 'var(--foreground)' }
                    }
                  >
                    <Icon size={14} aria-hidden />
                    {label}
                  </button>
                )
              })}
            </nav>

            <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3" aria-label={current.label}>
              <span className="hud-label">{current.label}</span>
              {current.content}
            </section>
          </aside>,
          document.body,
        )}
    </>
  )
}
