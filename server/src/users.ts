import type { Db } from './db.ts'
import { hashPassword } from './passwords.ts'

export type Role = 'admin' | 'operator'

export interface User {
  id: number
  username: string
  role: Role
}

interface UserRow extends User {
  password_hash: string
}

const USERNAME = /^[A-Za-z0-9._-]{1,64}$/
/** NIST SP 800-63B: at least 8, and allow long passphrases. */
export const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 256

export function validateNewCredentials(username: string, password: string): string | null {
  if (!USERNAME.test(username)) return 'usernames are 1–64 letters, digits, dots, dashes or underscores'
  if (password.length < MIN_PASSWORD_LENGTH) return `passwords need at least ${MIN_PASSWORD_LENGTH} characters`
  if (password.length > MAX_PASSWORD_LENGTH) return `passwords can be at most ${MAX_PASSWORD_LENGTH} characters`
  return null
}

export function findUserForLogin(db: Db, username: string): UserRow | undefined {
  return db.prepare('SELECT id, username, role, password_hash FROM users WHERE username = ?').get(username) as
    | UserRow
    | undefined
}

export function listUsers(db: Db): User[] {
  return db.prepare('SELECT id, username, role FROM users ORDER BY username').all() as unknown as User[]
}

export async function createUser(db: Db, username: string, password: string, role: Role): Promise<User> {
  const problem = validateNewCredentials(username, password)
  if (problem) throw new Error(problem)
  if (findUserForLogin(db, username)) throw new Error(`user ${username} already exists`)
  const hash = await hashPassword(password)
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
    .run(username, hash, role, Date.now())
  return { id: Number(lastInsertRowid), username, role }
}

/** Sets a new password and signs the user out everywhere. */
export async function setPassword(db: Db, username: string, password: string): Promise<void> {
  const problem = validateNewCredentials(username, password)
  if (problem) throw new Error(problem)
  const user = findUserForLogin(db, username)
  if (!user) throw new Error(`no user ${username}`)
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), user.id)
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id)
}

export function deleteUser(db: Db, username: string): boolean {
  return db.prepare('DELETE FROM users WHERE username = ?').run(username).changes > 0
}

/** First start: create the admin from ADMIN_USERNAME / ADMIN_PASSWORD if no
 * user has that name. Never overwrites an existing account's password. */
export async function seedAdmin(db: Db, username: string | undefined, password: string | undefined): Promise<User | null> {
  if (!username || !password) return null
  if (findUserForLogin(db, username)) return null
  return createUser(db, username, password, 'admin')
}
