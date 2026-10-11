import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { hashPassword, verifyPassword } from '../passwords.ts'
import { FailureLimiter } from '../rateLimit.ts'
import { createUser, seedAdmin, setPassword } from '../users.ts'
import { login, PASSWORD, testServer, type TestServer } from './helpers.ts'

describe('passwords', () => {
  it('verifies the right password and refuses a wrong one', async () => {
    const hash = await hashPassword('hunter2hunter2')
    assert.match(hash, /^\$argon2id\$v=19\$m=65536,t=3,p=4\$/)
    assert.equal(await verifyPassword('hunter2hunter2', hash), true)
    assert.equal(await verifyPassword('hunter3hunter3', hash), false)
  })

  it('salts every hash', async () => {
    assert.notEqual(await hashPassword('same password'), await hashPassword('same password'))
  })

  it('refuses a hash it cannot read instead of throwing', async () => {
    assert.equal(await verifyPassword('anything', 'not-a-hash'), false)
  })
})

describe('FailureLimiter', () => {
  it('blocks after max failures until the window passes, and resets on success', () => {
    let now = 0
    const limiter = new FailureLimiter(3, 1000, () => now)
    for (let i = 0; i < 3; i++) limiter.fail('k')
    assert.equal(limiter.retryAfterMs('k'), 1000)
    now = 1000
    assert.equal(limiter.retryAfterMs('k'), 0)
    limiter.fail('k')
    limiter.reset('k')
    assert.equal(limiter.retryAfterMs('k'), 0)
  })
})

describe('login API', () => {
  let server: TestServer
  beforeEach(async () => {
    server = await testServer()
  })
  afterEach(async () => {
    await server.app.close()
    server.db.close()
  })

  it('signs in, reports the user, and signs out', async () => {
    const { app } = server
    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'pilot', password: PASSWORD } })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.json(), { username: 'pilot', role: 'operator' })
    const cookie = res.cookies[0]!
    assert.equal(cookie.httpOnly, true)
    assert.equal(cookie.sameSite, 'Strict')

    const header = `${cookie.name}=${cookie.value}`
    const me = await app.inject({ url: '/api/me', headers: { cookie: header } })
    assert.deepEqual(me.json(), { username: 'pilot', role: 'operator' })

    assert.equal((await app.inject({ method: 'POST', url: '/api/logout', headers: { cookie: header } })).statusCode, 204)
    assert.equal((await app.inject({ url: '/api/me', headers: { cookie: header } })).statusCode, 401)
  })

  it('matches usernames without case', async () => {
    const res = await server.app.inject({ method: 'POST', url: '/api/login', payload: { username: 'PILOT', password: PASSWORD } })
    assert.equal(res.statusCode, 200)
  })

  it('gives the same answer for a wrong password and an unknown user', async () => {
    const wrong = await server.app.inject({ method: 'POST', url: '/api/login', payload: { username: 'pilot', password: 'nope-nope' } })
    const unknown = await server.app.inject({ method: 'POST', url: '/api/login', payload: { username: 'ghost', password: 'nope-nope' } })
    assert.equal(wrong.statusCode, 401)
    assert.equal(unknown.statusCode, 401)
    assert.deepEqual(wrong.json(), unknown.json())
    assert.equal(wrong.cookies.length, 0)
  })

  it('locks an account out after five failures, even with the right password', async () => {
    const { app } = server
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'pilot', password: 'wrong-wrong' } })
    }
    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'pilot', password: PASSWORD } })
    assert.equal(res.statusCode, 429)
    assert.ok(Number(res.headers['retry-after']) > 0)
  })

  it('refuses a malformed login', async () => {
    const res = await server.app.inject({ method: 'POST', url: '/api/login', payload: { username: 'pilot' } })
    assert.equal(res.statusCode, 400)
  })

  it('refuses a state-changing request from another site', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { origin: 'https://evil.example', host: 'fly.example' },
      payload: { username: 'pilot', password: PASSWORD },
    })
    assert.equal(res.statusCode, 403)
  })

  it('accepts a request from its own origin or an allowed one', async () => {
    const own = await server.app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { origin: 'https://fly.example', host: 'fly.example' },
      payload: { username: 'pilot', password: PASSWORD },
    })
    assert.equal(own.statusCode, 200)

    const other = await testServer({ allowedOrigins: ['http://localhost:5173'] })
    const allowed = await other.app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { origin: 'http://localhost:5173', host: 'localhost:8788' },
      payload: { username: 'pilot', password: PASSWORD },
    })
    assert.equal(allowed.statusCode, 200)
    await other.app.close()
  })

  it('expires sessions', async () => {
    const short = await testServer({ sessionTtlMs: -1 })
    const cookie = await login(short.app)
    assert.equal((await short.app.inject({ url: '/api/me', headers: { cookie } })).statusCode, 401)
    await short.app.close()
  })

  it('signs a user out everywhere when their password changes', async () => {
    const cookie = await login(server.app)
    await setPassword(server.db, 'pilot', 'a brand new password')
    assert.equal((await server.app.inject({ url: '/api/me', headers: { cookie } })).statusCode, 401)
  })

  it('names the cookie __Host-session when it is Secure', async () => {
    const secure = await testServer({ cookieSecure: true })
    const res = await secure.app.inject({ method: 'POST', url: '/api/login', payload: { username: 'pilot', password: PASSWORD } })
    assert.equal(res.cookies[0]?.name, '__Host-session')
    assert.equal(res.cookies[0]?.secure, true)
    await secure.app.close()
  })
})

describe('users', () => {
  it('seeds the admin once and never overwrites it', async () => {
    const { db, app } = await testServer()
    assert.equal((await seedAdmin(db, 'boss', 'first password'))?.role, 'admin')
    assert.equal(await seedAdmin(db, 'boss', 'second password'), null)
    await login(app, 'boss', 'first password')
    await app.close()
  })

  it('refuses short passwords, odd usernames and duplicates', async () => {
    const { db, app } = await testServer()
    await assert.rejects(createUser(db, 'shorty', 'short', 'operator'), /at least 8/)
    await assert.rejects(createUser(db, 'has space', 'long enough', 'operator'), /usernames/)
    await assert.rejects(createUser(db, 'Pilot', 'long enough', 'operator'), /already exists/)
    await app.close()
  })
})
