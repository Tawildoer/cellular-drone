import type { Mission } from '../../domain'
import { UnauthorizedError } from '../AuthClient'
import type { MissionRepository } from '../MissionRepository'
import { createRequester, errorFrom, type HttpOptions } from './request'

/** Missions stored on the server (server/src/missions.ts), shared by every
 * signed-in user. The server sets id, createdAt and updatedAt. */
export class HttpMissionRepository implements MissionRepository {
  private readonly request: ReturnType<typeof createRequester>

  constructor(opts: HttpOptions = {}) {
    this.request = createRequester(opts)
  }

  async list(): Promise<Mission[]> {
    return (await this.ok(await this.request('GET', '/api/missions'))).json() as Promise<Mission[]>
  }

  async get(id: string): Promise<Mission | null> {
    const res = await this.request('GET', `/api/missions/${encodeURIComponent(id)}`)
    if (res.status === 404) return null
    return (await this.ok(res)).json() as Promise<Mission>
  }

  async save(mission: Mission): Promise<Mission> {
    const res = mission.id
      ? await this.request('PUT', `/api/missions/${encodeURIComponent(mission.id)}`, mission)
      : await this.request('POST', '/api/missions', mission)
    return (await this.ok(res)).json() as Promise<Mission>
  }

  async delete(id: string): Promise<void> {
    await this.ok(await this.request('DELETE', `/api/missions/${encodeURIComponent(id)}`))
  }

  private async ok(res: Response): Promise<Response> {
    if (res.status === 401) throw new UnauthorizedError('Signed out: log in again')
    if (!res.ok) throw await errorFrom(res)
    return res
  }
}
