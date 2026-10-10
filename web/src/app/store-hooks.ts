import { createContext, useContext, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useStore } from 'zustand'
import {
  createCoverageStore,
  createFlightLogStore,
  type CoverageStore,
  type CoverageStoreState,
  type AuthState,
  type AuthStore,
  type FlightLogStore,
  type FlightLogStoreState,
  type MissionStore,
  type MissionStoreState,
  type VehicleStore,
  type VehicleStoreState,
} from '../state'
import type { MissionTranslator, TerrainService, WeatherService } from '../services'
import { ArduPilotMissionTranslator } from '../services/ardupilot'
import { InMemoryCoverageRepository, InMemoryFlightLogRepository } from '../services/mock'

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

/** The vehicle store itself, for reading it in an event handler without
 * re-rendering on every telemetry update. */
export function useVehicleStoreApi(): VehicleStore {
  return useAppStores().vehicleStore
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

/** Provided from AppServices; null (no weather overlays) by default. */
export const WeatherServiceContext = createContext<WeatherService | null>(null)

export function useWeatherService(): WeatherService | null {
  return useContext(WeatherServiceContext)
}

/** Provided from AppServices; the default keeps records in memory, so
 * feature tests don't need to wire one up. */
export const FlightLogContext = createContext<FlightLogStore>(createFlightLogStore(new InMemoryFlightLogRepository()))

export function useFlightLog<T>(selector: (s: FlightLogStoreState) => T): T {
  return useStore(useContext(FlightLogContext), selector)
}

/** The cell coverage measured on earlier flights; in memory by default, as
 * above. */
export const CoverageContext = createContext<CoverageStore>(createCoverageStore(new InMemoryCoverageRepository()))

export function useCoverage<T>(selector: (s: CoverageStoreState) => T): T {
  return useStore(useContext(CoverageContext), selector)
}

/** A section the app adds to the flight screen's menu, e.g. the simulator's
 * controls, which only app/ may build (they talk to a concrete link). */
export interface MenuSection {
  id: string
  label: string
  icon: LucideIcon
  content: ReactNode
}

export const MenuExtrasContext = createContext<MenuSection[]>([])

export function useMenuExtras(): MenuSection[] {
  return useContext(MenuExtrasContext)
}
