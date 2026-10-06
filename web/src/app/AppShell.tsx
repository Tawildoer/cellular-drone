import { useState } from 'react'
import { FlightScreen } from '../features/flight/FlightScreen'
import { LoginScreen } from '../features/login/LoginScreen'
import { VehicleListScreen } from '../features/vehicle-list/VehicleListScreen'
import { VEHICLES } from './config'
import { useAuthStore, useVehicleStore } from './store-hooks'

type Screen = 'vehicleList' | 'flight'

export function AppShell() {
  const user = useAuthStore((s) => s.user)
  const disconnect = useVehicleStore((s) => s.disconnect)
  const [screen, setScreen] = useState<Screen>('vehicleList')

  if (!user) return <LoginScreen />

  if (screen === 'vehicleList') {
    return <VehicleListScreen vehicles={VEHICLES} onConnected={() => setScreen('flight')} />
  }

  return (
    <FlightScreen
      onBack={() => {
        void disconnect()
        setScreen('vehicleList')
      }}
    />
  )
}
