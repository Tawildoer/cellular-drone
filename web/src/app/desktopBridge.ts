/**
 * What the Mac app (desktop/, ADR-0027) exposes to the UI through its
 * preload script; absent in a normal browser. Mirrors desktop/src/preload.ts.
 */
export interface DesktopBridge {
  info(): Promise<{
    uiVersion: string
    uiBuiltAt: number
    appVersion: string
    updateReady: string | null
    /** The dev server it's running live from (Develop menu), or null. */
    liveFrom?: string | null
  }>
  /** Calls back when a newer UI has downloaded and checked out; returns an
   * unsubscribe. */
  onUpdateReady(listener: (update: { version: string }) => void): () => void
  /** Switches to the downloaded UI and reloads the window. */
  applyUpdate(): Promise<boolean>
}

declare global {
  interface Window {
    droneDesktop?: DesktopBridge
  }
}

export function desktopBridge(): DesktopBridge | null {
  return typeof window !== 'undefined' ? (window.droneDesktop ?? null) : null
}
