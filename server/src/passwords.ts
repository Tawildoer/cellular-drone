import { argon2, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * argon2id password hashes in the standard PHC string format
 * ($argon2id$v=19$m=…,t=…,p=…$salt$hash), using Node's built-in argon2 so the
 * server has no native modules. Parameters are RFC 9106's second
 * recommendation (64 MiB, 3 passes, 4 lanes): ~30 ms per hash on a laptop.
 */
const PARAMS = { memory: 65536, passes: 3, parallelism: 4, tagLength: 32 }
const SALT_BYTES = 16

function derive(password: string, salt: Buffer, params: typeof PARAMS): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2('argon2id', { message: password, nonce: salt, ...params }, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

const b64 = (buf: Buffer) => buf.toString('base64').replace(/=+$/, '')

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const key = await derive(password, salt, PARAMS)
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${b64(salt)}$${b64(key)}`
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/

/** False for a wrong password or a hash it can't read. Reads the parameters
 * from the hash, so raising PARAMS later doesn't lock anyone out. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const match = PHC.exec(hash)
  if (!match) return false
  const [, m, t, p, salt, expectedB64] = match
  const expected = Buffer.from(expectedB64!, 'base64')
  const key = await derive(password, Buffer.from(salt!, 'base64'), {
    memory: Number(m),
    passes: Number(t),
    parallelism: Number(p),
    tagLength: expected.length,
  })
  return timingSafeEqual(key, expected)
}

/** A real hash of nothing in particular: checked against when the username
 * doesn't exist, so a login takes as long either way. */
let dummyHash: Promise<string> | undefined
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'))
  return dummyHash
}
