import type { KeyObject } from 'node:crypto'
import type { Db } from './db.ts'
import { parsePublicKey } from './keys.ts'

/** The drone registry: which vehicle ids exist and the public half of each
 * one's key. The private half never leaves the drone (ADR-0030). */
export interface Drone {
  id: string
  name: string
  publicKey: string
}

const VEHICLE_ID = /^[A-Za-z0-9._-]{1,64}$/

export function addDrone(db: Db, id: string, publicKey: string, name = id): Drone {
  if (!VEHICLE_ID.test(id)) throw new Error('vehicle ids are 1–64 letters, digits, dots, dashes or underscores')
  parsePublicKey(publicKey)
  if (findDrone(db, id)) throw new Error(`drone ${id} already exists (drone:remove it first to change its key)`)
  db.prepare('INSERT INTO drones (id, name, public_key, created_at) VALUES (?, ?, ?, ?)').run(id, name, publicKey, Date.now())
  return { id, name, publicKey }
}

export function findDrone(db: Db, id: string): Drone | undefined {
  return db.prepare('SELECT id, name, public_key AS publicKey FROM drones WHERE id = ?').get(id) as Drone | undefined
}

export function listDrones(db: Db): Drone[] {
  return db.prepare('SELECT id, name, public_key AS publicKey FROM drones ORDER BY id').all() as unknown as Drone[]
}

export function removeDrone(db: Db, id: string): boolean {
  return db.prepare('DELETE FROM drones WHERE id = ?').run(id).changes > 0
}

/** The drone's key for checking its signature, or undefined if unknown. */
export function droneKey(db: Db, id: string): KeyObject | undefined {
  const drone = findDrone(db, id)
  return drone ? parsePublicKey(drone.publicKey) : undefined
}
