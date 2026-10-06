import { useState } from 'react'
import type { VehicleDescriptor } from '../../domain'
import { useAuthStore, useVehicleStore } from '../../app/store-hooks'
import { Button } from '../../components/ui/button'

export function VehicleListScreen({
  vehicles,
  onConnected,
}: {
  vehicles: VehicleDescriptor[]
  onConnected: (vehicleId: string) => void
}) {
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
        {vehicles.map((vehicle) => (
          <Button
            key={vehicle.id}
            type="button"
            variant="secondary"
            className="h-auto justify-between py-3"
            disabled={connectingId !== null}
            onClick={() => handleSelect(vehicle.id)}
          >
            <span className="flex flex-col items-start gap-0.5">
              <span className="flex items-center gap-2">
                {vehicle.name}
                {vehicle.demo && (
                  <span
                    className="hud-label rounded px-1.5 py-0.5 text-[10px] leading-none"
                    style={{ color: 'var(--primary)', border: '1px solid var(--primary)' }}
                  >
                    Demo
                  </span>
                )}
              </span>
              {vehicle.demo && <span className="text-[11px] opacity-60">Simulated flight · no hardware</span>}
            </span>
            <span className="hud-label">
              {connectingId === vehicle.id ? 'Connecting…' : vehicle.demo ? 'Launch' : 'Connect'}
            </span>
          </Button>
        ))}
      </div>
    </main>
  )
}
