import { useState } from 'react'
import { useAuthStore, useVehicleStore } from '../../app/store-hooks'
import { Button } from '../../components/ui/button'

// One drone for now (docs/FRONTEND.md) — a real fleet would come from an API.
const VEHICLES = [{ id: 'drone-1', name: 'Drone 1' }]

export function VehicleListScreen({ onConnected }: { onConnected: (vehicleId: string) => void }) {
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const username = useAuthStore((s) => s.user?.username)
  const logout = useAuthStore((s) => s.logout)
  const connect = useVehicleStore((s) => s.connect)

  async function handleSelect(vehicleId: string) {
    setConnectingId(vehicleId)
    try {
      await connect(vehicleId)
      onConnected(vehicleId)
    } finally {
      setConnectingId(null)
    }
  }

  return (
    <main className="flex min-h-svh flex-col items-center gap-6 p-6">
      <header className="flex w-full max-w-sm items-center justify-between pt-2">
        <span className="hud-label">Signed in as {username}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => logout()}>
          Sign out
        </Button>
      </header>

      <div className="glass-panel flex w-full max-w-sm flex-col gap-3 px-6 py-7">
        <span className="hud-label">Vehicles</span>
        {VEHICLES.map((vehicle) => (
          <Button
            key={vehicle.id}
            type="button"
            variant="secondary"
            className="justify-between"
            disabled={connectingId !== null}
            onClick={() => handleSelect(vehicle.id)}
          >
            <span>{vehicle.name}</span>
            <span className="hud-label">{connectingId === vehicle.id ? 'Connecting…' : 'Connect'}</span>
          </Button>
        ))}
      </div>
    </main>
  )
}
