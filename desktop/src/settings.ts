import { readFileSync, writeFileSync } from 'node:fs'

/** What the app remembers between launches. */
export interface Settings {
  /** Load the UI from the local Vite dev server instead of a bundle. */
  liveFromDevServer: boolean
}

const DEFAULTS: Settings = { liveFromDevServer: false }

export function loadSettings(file: string): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<Settings>) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(file: string, settings: Settings): void {
  writeFileSync(file, JSON.stringify(settings, null, 2))
}
