import { describe, expect, it } from 'vitest'
import { authClientContract } from '../../__tests__/authClientContract'
import { MockAuthClient } from '../MockAuthClient'

authClientContract('MockAuthClient', () => new MockAuthClient({ username: 'operator', password: 'secret' }), 'operator', 'secret')

describe('MockAuthClient', () => {
  it('falls back to default credentials when none are given', async () => {
    const defaultClient = new MockAuthClient()
    const user = await defaultClient.login('operator', 'changeme')
    expect(user).toEqual({ username: 'operator' })
  })
})
