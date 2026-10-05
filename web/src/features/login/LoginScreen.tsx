import { useState, type FormEvent } from 'react'
import { useAuthStore } from '../../app/store-hooks'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'

export function LoginScreen() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const status = useAuthStore((s) => s.status)
  const error = useAuthStore((s) => s.error)
  const login = useAuthStore((s) => s.login)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    await login(username, password)
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="glass-panel flex w-full max-w-sm flex-col gap-5 px-6 py-7">
        <div>
          <span className="hud-label">Cellular Drone Console</span>
          <h1 className="mt-1 text-lg font-semibold text-foreground">Operator sign-in</h1>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="username" className="hud-label">
            Username
          </Label>
          <Input
            id="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={status === 'loading'}
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password" className="hud-label">
            Password
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={status === 'loading'}
            required
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'Connecting…' : 'Sign in'}
        </Button>
      </form>
    </main>
  )
}
