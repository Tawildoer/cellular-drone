import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { login, testServer, type TestServer } from './helpers.ts'

const draft = {
  name: 'survey',
  items: [{ type: 'vtolTakeoff', altM: 50 }, { type: 'waypoint', lat: -37.86, lon: 145.06, altM: 80 }, { type: 'returnToLaunch' }],
}

describe('missions API', () => {
  let server: TestServer
  let cookie: string
  beforeEach(async () => {
    server = await testServer()
    cookie = await login(server.app)
  })
  afterEach(async () => {
    await server.app.close()
    server.db.close()
  })

  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    server.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) })

  it('needs a signed-in user', async () => {
    assert.equal((await server.app.inject({ url: '/api/missions' })).statusCode, 401)
    assert.equal((await server.app.inject({ method: 'POST', url: '/api/missions', payload: draft })).statusCode, 401)
  })

  it('creates with a server id and timestamps, then reads it back', async () => {
    const created = await call('POST', '/api/missions', { ...draft, id: '', createdAt: 0, updatedAt: 0 })
    assert.equal(created.statusCode, 201)
    const mission = created.json()
    assert.ok(mission.id)
    assert.ok(mission.createdAt > 0)
    assert.equal(mission.updatedAt, mission.createdAt)
    assert.deepEqual((await call('GET', `/api/missions/${mission.id}`)).json(), mission)
  })

  it('updates in place, keeping createdAt', async () => {
    const first = (await call('POST', '/api/missions', draft)).json()
    await new Promise((r) => setTimeout(r, 2))
    const updated = await call('PUT', `/api/missions/${first.id}`, { ...first, name: 'v2', createdAt: 1 })
    assert.equal(updated.statusCode, 200)
    assert.equal(updated.json().name, 'v2')
    assert.equal(updated.json().createdAt, first.createdAt)
    assert.ok(updated.json().updatedAt > first.updatedAt)
    assert.equal((await call('GET', '/api/missions')).json().length, 1)
  })

  it('lists newest-updated first', async () => {
    const a = (await call('POST', '/api/missions', { ...draft, name: 'a' })).json()
    await new Promise((r) => setTimeout(r, 2))
    const b = (await call('POST', '/api/missions', { ...draft, name: 'b' })).json()
    assert.deepEqual(
      (await call('GET', '/api/missions')).json().map((m: { id: string }) => m.id),
      [b.id, a.id],
    )
  })

  it('refuses a mission that does not match the protocol schema', async () => {
    const res = await call('POST', '/api/missions', { name: 'bad', items: [{ type: 'teleport' }] })
    assert.equal(res.statusCode, 400)
  })

  it('404s a missing mission, and deleting one twice is fine', async () => {
    assert.equal((await call('GET', '/api/missions/nope')).statusCode, 404)
    assert.equal((await call('PUT', '/api/missions/nope', draft)).statusCode, 404)
    const created = (await call('POST', '/api/missions', draft)).json()
    assert.equal((await call('DELETE', `/api/missions/${created.id}`)).statusCode, 204)
    assert.equal((await call('DELETE', `/api/missions/${created.id}`)).statusCode, 204)
    assert.equal((await call('GET', `/api/missions/${created.id}`)).statusCode, 404)
  })
})
