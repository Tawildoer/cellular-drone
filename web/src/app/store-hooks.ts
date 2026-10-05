import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type {
  AuthState,
  AuthStore,
  MissionStore,
  MissionStoreState,
  VehicleStore,
  VehicleStoreState,
} from '../state'

export interface AppStores {
  authStore: AuthStore
  vehicleStore: VehicleStore
  missionStore: MissionStore
}

export const AppStoresContext = createContext<AppStores | null>(null)

function useAppStores(): AppStores {
  const stores = useContext(AppStoresContext)
  if (!stores) throw new Error('useAppStores must be used within <AppProviders>')
  return stores
}

export function useAuthStore<T>(selector: (s: AuthState) => T): T {
  return useStore(useAppStores().authStore, selector)
}

export function useVehicleStore<T>(selector: (s: VehicleStoreState) => T): T {
  return useStore(useAppStores().vehicleStore, selector)
}

export function useMissionStore<T>(selector: (s: MissionStoreState) => T): T {
  return useStore(useAppStores().missionStore, selector)
}
