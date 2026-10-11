import { createInterface } from 'node:readline'
import { loadConfig } from './config.ts'
import { openDb } from './db.ts'
import { createUser, deleteUser, listUsers, setPassword, type Role } from './users.ts'

/**
 * Account admin from the shell, against the server's database (DB_PATH):
 *
 *   npm run cli -- user:add <name> [--admin]
 *   npm run cli -- user:passwd <name>
 *   npm run cli -- user:remove <name>
 *   npm run cli -- user:list
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

async function main(argv: string[]): Promise<void> {
  const [command, name, ...flags] = argv
  const db = openDb(loadConfig().dbPath)
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
      default:
        throw new Error('commands: user:add <name> [--admin], user:passwd <name>, user:remove <name>, user:list')
    }
  } finally {
    db.close()
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
