import { beforeEach, describe, expect, it } from 'vitest'
import { UnauthorizedError } from '../../AuthClient'
import { MockAuthClient } from '../MockAuthClient'

describe('MockAuthClient', () => {
  let client: MockAuthClient

  beforeEach(() => {
    client = new MockAuthClient({ username: 'operator', password: 'secret' })
  })

  it('has no user before logging in', async () => {
    expect(await client.me()).toBeNull()
  })

  it('logs in with the right credentials', async () => {
    const user = await client.login('operator', 'secret')
    expect(user).toEqual({ username: 'operator' })
    expect(await client.me()).toEqual({ username: 'operator' })
  })

  it('throws UnauthorizedError on a bad password', async () => {
    await expect(client.login('operator', 'wrong')).rejects.toBeInstanceOf(UnauthorizedError)
    expect(await client.me()).toBeNull()
  })

  it('throws UnauthorizedError on a bad username', async () => {
    await expect(client.login('someone-else', 'secret')).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('clears the session on logout', async () => {
    await client.login('operator', 'secret')
    await client.logout()
    expect(await client.me()).toBeNull()
  })

  it('falls back to default credentials when none are given', async () => {
    const defaultClient = new MockAuthClient()
    const user = await defaultClient.login('operator', 'changeme')
    expect(user).toEqual({ username: 'operator' })
  })
})
