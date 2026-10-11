import { beforeEach, describe, expect, it } from 'vitest'
import type { AuthClient } from '../AuthClient'
import { UnauthorizedError } from '../AuthClient'

/**
 * What every AuthClient must do (FRONTEND.md: implementations share contract
 * tests). `create` returns a signed-out client that accepts `username` /
 * `password`.
 */
export function authClientContract(name: string, create: () => AuthClient, username: string, password: string) {
  describe(`${name} (AuthClient contract)`, () => {
    let client: AuthClient

    beforeEach(() => {
      client = create()
    })

    it('has no user before logging in', async () => {
      expect(await client.me()).toBeNull()
    })

    it('logs in with the right credentials', async () => {
      const user = await client.login(username, password)
      expect(user.username).toBe(username)
      expect((await client.me())?.username).toBe(username)
    })

    it('throws UnauthorizedError on a bad password', async () => {
      await expect(client.login(username, `${password}-wrong`)).rejects.toBeInstanceOf(UnauthorizedError)
      expect(await client.me()).toBeNull()
    })

    it('throws UnauthorizedError on a bad username', async () => {
      await expect(client.login(`${username}-else`, password)).rejects.toBeInstanceOf(UnauthorizedError)
    })

    it('clears the session on logout', async () => {
      await client.login(username, password)
      await client.logout()
      expect(await client.me()).toBeNull()
    })
  })
}
