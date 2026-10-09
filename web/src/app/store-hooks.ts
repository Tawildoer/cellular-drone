import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import {
  createFlightLogStore,
  type AuthState,
  type AuthStore,
  type FlightLogStore,
  type FlightLogStoreState,
  type MissionStore,
  type MissionStoreState,
  type VehicleStore,
  type VehicleStoreState,
} from '../state'
import type { MissionTranslator, TerrainService } from '../services'
import { ArduPilotMissionTranslator } from '../services/ardupilot'
import { InMemoryFlightLogRepository } from '../services/mock'

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

/** Provided from AppServices; the default keeps records in memory, so
 * feature tests don't need to wire one up. */
export const FlightLogContext = createContext<FlightLogStore>(createFlightLogStore(new InMemoryFlightLogRepository()))

export function useFlightLog<T>(selector: (s: FlightLogStoreState) => T): T {
  return useStore(useContext(FlightLogContext), selector)
}
