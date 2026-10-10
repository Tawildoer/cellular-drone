import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { desktopBridge } from './desktopBridge'

/**
 * In the Mac app only (ADR-0027): once a newer version of the UI has
 * downloaded, offers to reload into it. Never reloads by itself, so an
 * update can't land in the middle of something. A reload doesn't touch the
 * drone (with the in-browser simulated drone, it restarts the simulation).
 */
export function DesktopUpdatePrompt() {
  const [ready, setReady] = useState<string | null>(null)
  const [liveFrom, setLiveFrom] = useState<string | null>(null)

  useEffect(() => {
    const bridge = desktopBridge()
    if (!bridge) return
    // One may have finished before this mounted.
    void bridge.info().then((info) => {
      if (info.updateReady) setReady(info.updateReady)
      setLiveFrom(info.liveFrom ?? null)
    })
    return bridge.onUpdateReady((update) => setReady(update.version))
  }, [])

  // Running live from the dev server (Develop menu): say so, unmissably,
  // so it's never confused with the installed version.
  if (liveFrom) {
    return (
      <div
        role="status"
        title={`Live from ${liveFrom}: Develop → Live from Local Dev Server (⌘⇧D) to switch back`}
        className="pointer-events-none fixed bottom-2 left-1/2 z-50 -translate-x-1/2 rounded-full px-2.5 py-0.5 text-[0.625rem] font-semibold tracking-wide text-black"
        style={{ background: 'var(--status-warning)' }}
      >
        LIVE · {liveFrom.replace(/^https?:\/\//, '')}
      </div>
    )
  }
  if (!ready) return null
  return (
    <div role="status" className="glass-panel fixed left-1/2 top-16 z-50 flex -translate-x-1/2 items-center gap-2 py-1 pl-3 pr-1">
      <RefreshCw size={12} aria-hidden style={{ color: 'var(--primary)' }} />
      <span className="hud-label" style={{ color: 'var(--primary)' }}>
        Update ready
      </span>
      <button
        type="button"
        onClick={() => void desktopBridge()?.applyUpdate()}
        className="rounded-md bg-secondary glass-tile px-2 py-0.5 text-xs font-medium transition hover:bg-white/10"
      >
        Reload
      </button>
      <button
        type="button"
        aria-label="Later"
        title="Later: it applies the next time the app starts"
        onClick={() => setReady(null)}
        className="rounded-md px-2 py-0.5 text-xs text-[var(--muted-foreground)] transition hover:bg-white/10"
      >
        Later
      </button>
    </div>
  )
}
