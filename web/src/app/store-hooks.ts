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
import type { MissionTranslator, TerrainService } from '../services'
import { ArduPilotMissionTranslator } from '../services/ardupilot'

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

/** Provided from AppServices; the default lets feature tests render planner
 * panels without wiring one up. */
export const MissionTranslatorContext = createContext<MissionTranslator>(new ArduPilotMissionTranslator())

export function useMissionTranslator(): MissionTranslator {
  return useContext(MissionTranslatorContext)
}

/** Provided from AppServices; null (no terrain source) by default. */
export const TerrainServiceContext = createContext<TerrainService | null>(null)

export function useTerrainService(): TerrainService | null {
  return useContext(TerrainServiceContext)
}
