import { describe, expect, it } from 'vitest'
import { RateLimitedError, UnauthorizedError } from '../../AuthClient'
import { authClientContract } from '../../__tests__/authClientContract'
import { draftMission, missionRepositoryContract } from '../../__tests__/missionRepositoryContract'
import { HttpAuthClient } from '../HttpAuthClient'
import { HttpMissionRepository } from '../HttpMissionRepository'
import { HttpError } from '../request'
import { fakeServer } from './fakeServer'

authClientContract('HttpAuthClient', () => new HttpAuthClient({ fetch: fakeServer('pilot', 'secret-pw').fetch }), 'pilot', 'secret-pw')

missionRepositoryContract('HttpMissionRepository', () => {
  const server = fakeServer('pilot', 'secret-pw')
  server.signIn()
  return new HttpMissionRepository({ fetch: server.fetch })
})

describe('HttpAuthClient', () => {
  it('says so when the server is refusing logins for a while', async () => {
    const client = new HttpAuthClient({ fetch: fakeServer('pilot', 'secret-pw').fetch })
    for (let i = 0; i < 5; i++) await client.login('pilot', 'wrong').catch(() => {})
    await expect(client.login('pilot', 'secret-pw')).rejects.toBeInstanceOf(RateLimitedError)
  })

  it('calls the API on the configured base URL', async () => {
    const seen: string[] = []
    const client = new HttpAuthClient({
      baseUrl: 'https://fly.example',
      fetch: async (input) => {
        seen.push(String(input))
        return new Response(null, { status: 401 })
      },
    })
    await client.me()
    expect(seen).toEqual(['https://fly.example/api/me'])
  })
})

describe('HttpMissionRepository', () => {
  it('throws UnauthorizedError once the session has gone', async () => {
    const server = fakeServer('pilot', 'secret-pw')
    const repo = new HttpMissionRepository({ fetch: server.fetch })
    await expect(repo.list()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it("passes on the server's reason for refusing a mission", async () => {
    const repo = new HttpMissionRepository({
      fetch: async () => new Response(JSON.stringify({ error: 'invalid mission' }), { status: 400 }),
    })
    const err = await repo.save(draftMission()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect(err).toMatchObject({ status: 400, message: 'invalid mission' })
  })
})
