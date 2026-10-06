import { useEffect, useState, type ReactNode } from 'react'
import { MockLink } from '../link/mock'
import { createAuthStore, createMissionStore, createVehicleStore } from '../state'
import { createAppServices, type AppServices } from './config'
import { MockDevTools } from './MockDevTools'
import { AppStoresContext, useVehicleStore, type AppStores } from './store-hooks'
import { DEFAULT_USERNAME, DEFAULT_PASSWORD } from '../services/mock'

export function AppProviders({ children }: { children: ReactNode }) {
  const [services] = useState<AppServices>(() => createAppServices())
  const [stores] = useState<AppStores>(() => ({
    authStore: createAuthStore(services.authClient),
    vehicleStore: createVehicleStore(services.resolveVehicleLink),
    missionStore: createMissionStore(services.missionRepository),
  }))

  // Dev convenience only: skip retyping the dev credentials on every reload
  // while iterating. Falls back to the real login screen if this ever
  // doesn't match (e.g. custom VITE_DEV_USERNAME/PASSWORD mismatch) — it's
  // not a replacement for the login flow, just friction removal for now.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const username = import.meta.env.VITE_DEV_USERNAME ?? DEFAULT_USERNAME
    const password = import.meta.env.VITE_DEV_PASSWORD ?? DEFAULT_PASSWORD
    void stores.authStore.getState().login(username, password)
  }, [stores])

  return (
    <AppStoresContext.Provider value={stores}>
      {children}
      <DevTools />
    </AppStoresContext.Provider>
  )
}

/** Sim tuning panel (speed, look-ahead), shown whenever the connected vehicle
 * is the in-browser sim — the demo drone, or any vehicle in a mock build — in
 * every build, including the public demo. Never for a real vehicle link. */
function DevTools() {
  const activeLink = useVehicleStore((s) => s.activeLink)
  return activeLink instanceof MockLink ? <MockDevTools link={activeLink} /> : null
}
