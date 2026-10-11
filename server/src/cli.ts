import { createInterface } from 'node:readline'
import { loadConfig } from './config.ts'
import { openDb } from './db.ts'
import { addDrone, listDrones, removeDrone } from './drones.ts'
import { loadOrCreateSigningKey } from './keys.ts'
import { createUser, deleteUser, listUsers, setPassword, type Role } from './users.ts'

/**
 * Admin from the shell, against the server's database (DB_PATH) and keys:
 *
 *   npm run cli -- user:add <name> [--admin]
 *   npm run cli -- user:passwd <name>
 *   npm run cli -- user:remove <name>
 *   npm run cli -- user:list
 *   npm run cli -- drone:add <id> <public key> [--name <name>]   (agent -print-key)
 *   npm run cli -- drone:remove <id>
 *   npm run cli -- drone:list
 *   npm run cli -- keys:show      (the agents' -server-pubkey; creates the key if needed)
 *
 * Passwords are read from the terminal without echo, or from the PASSWORD
 * environment variable for scripts, never from the command line (it would
 * land in shell history and `ps`).
 */
async function readPassword(prompt: string): Promise<string> {
  if (process.env.PASSWORD) return process.env.PASSWORD
  if (!process.stdin.isTTY) throw new Error('no terminal to read a password from: set PASSWORD')
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  // Echo nothing while the password is typed.
  const output = rl as unknown as { _writeToOutput: (s: string) => void }
  const ask = (q: string) =>
    new Promise<string>((resolve) => {
      process.stdout.write(q)
      output._writeToOutput = () => {}
      rl.question('', (answer) => {
        process.stdout.write('\n')
        resolve(answer)
      })
    })
  try {
    const first = await ask(prompt)
    const second = await ask('Again: ')
    if (first !== second) throw new Error("passwords don't match")
    return first
  } finally {
    rl.close()
  }
}

const USAGE = `commands:
  user:add <name> [--admin]   user:passwd <name>   user:remove <name>   user:list
  drone:add <id> <public key> [--name <name>]   drone:remove <id>   drone:list
  keys:show`

async function main(argv: string[]): Promise<void> {
  const [command, name, ...flags] = argv
  const config = loadConfig()
  if (command === 'keys:show') {
    console.log(loadOrCreateSigningKey(config.signingKeyFile).publicKey)
    return
  }
  const db = openDb(config.dbPath)
  try {
    switch (command) {
      case 'user:add': {
        if (!name) throw new Error('usage: user:add <name> [--admin]')
        const role: Role = flags.includes('--admin') ? 'admin' : 'operator'
        const user = await createUser(db, name, await readPassword(`Password for ${name}: `), role)
        console.log(`added ${user.username} (${user.role})`)
        return
      }
      case 'user:passwd':
        if (!name) throw new Error('usage: user:passwd <name>')
        await setPassword(db, name, await readPassword(`New password for ${name}: `))
        console.log(`password changed for ${name}; their sessions are signed out`)
        return
      case 'user:remove':
        if (!name) throw new Error('usage: user:remove <name>')
        if (!deleteUser(db, name)) throw new Error(`no user ${name}`)
        console.log(`removed ${name}`)
        return
      case 'user:list':
        for (const user of listUsers(db)) console.log(`${user.username}\t${user.role}`)
        return
      case 'drone:add': {
        const [publicKey, ...rest] = flags
        if (!name || !publicKey) throw new Error('usage: drone:add <id> <public key> [--name <name>]')
        const nameAt = rest.indexOf('--name')
        const drone = addDrone(db, name, publicKey, nameAt >= 0 ? rest[nameAt + 1] : undefined)
        console.log(`added drone ${drone.id} (${drone.name})`)
        return
      }
      case 'drone:remove':
        if (!name) throw new Error('usage: drone:remove <id>')
        if (!removeDrone(db, name)) throw new Error(`no drone ${name}`)
        console.log(`removed drone ${name}`)
        return
      case 'drone:list':
        for (const drone of listDrones(db)) console.log(`${drone.id}\t${drone.name}\t${drone.publicKey}`)
        return
      default:
        throw new Error(USAGE)
    }
  } finally {
    db.close()
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
