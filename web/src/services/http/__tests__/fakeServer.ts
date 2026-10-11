import type { Mission } from '../../../domain'

/**
 * A stand-in for server/'s HTTP API, behind a fetch function: just enough of
 * its behaviour (status codes, server-set ids and timestamps, the session) to
 * hold the HTTP clients to the shared contracts. server/'s own tests cover
 * the real thing.
 */
export function fakeServer(username: string, password: string) {
  let signedIn = false
  let failures = 0
  const missions = new Map<string, Mission>()
  const json = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
    })

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://fake')
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined

    if (url.pathname === '/api/login' && method === 'POST') {
      if (failures >= 5) return json(429, { error: 'too many failed logins, try again later' })
      if (body?.username !== username || body?.password !== password) {
        failures++
        return json(401, { error: 'invalid username or password' })
      }
      signedIn = true
      return json(200, { username, role: 'operator' })
    }
    if (url.pathname === '/api/logout' && method === 'POST') {
      signedIn = false
      return json(204)
    }
    if (!signedIn) return json(401, { error: 'not signed in' })
    if (url.pathname === '/api/me') return json(200, { username, role: 'operator' })

    const match = /^\/api\/missions(?:\/([^/]+))?$/.exec(url.pathname)
    if (!match) return json(404, { error: 'not found' })
    const id = match[1] && decodeURIComponent(match[1])
    const now = Date.now()
    if (!id && method === 'GET') return json(200, [...missions.values()].sort((a, b) => b.updatedAt - a.updatedAt))
    if (!id && method === 'POST') {
      const mission = { ...(body as unknown as Mission), id: crypto.randomUUID(), createdAt: now, updatedAt: now }
      missions.set(mission.id, mission)
      return json(201, mission)
    }
    if (!id) return json(405)
    const existing = missions.get(id)
    if (method === 'GET') return existing ? json(200, existing) : json(404, { error: 'no such mission' })
    if (method === 'PUT') {
      if (!existing) return json(404, { error: 'no such mission' })
      const mission = { ...(body as unknown as Mission), id, createdAt: existing.createdAt, updatedAt: now }
      missions.set(id, mission)
      return json(200, mission)
    }
    if (method === 'DELETE') {
      missions.delete(id)
      return json(204)
    }
    return json(405)
  }

  return {
    fetch,
    signIn() {
      signedIn = true
    },
  }
}
