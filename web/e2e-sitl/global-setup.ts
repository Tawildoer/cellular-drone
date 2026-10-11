import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdirSync, mkdtempSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const REPO = path.resolve(import.meta.dirname, '../..')
const BIN_DIR = path.join(tmpdir(), 'cellular-drone-e2e-sitl')
const LOG_DIR = path.join(REPO, 'web', 'test-results-sitl')

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection({ port, host: '127.0.0.1' })
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() > deadline) reject(new Error(`port ${port} never opened`))
        else setTimeout(attempt, 500)
      })
    }
    attempt()
  })
}

/** The account the tests sign in with, created by the server on start. */
export const E2E_USER = { username: 'e2e', password: 'e2e-sitl-password' }

function start(name: string, command: string, args: string[], cwd: string, env: Record<string, string> = {}): ChildProcess {
  const log = createWriteStream(path.join(LOG_DIR, `${name}.log`))
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } })
  child.stdout?.pipe(log)
  child.stderr?.pipe(log)
  return child
}

/** Builds the Go tools, makes sure the SITL image exists, then starts the
 * server and the agent (pointed at SITL) with real keys (ADR-0030): a fresh
 * drone key registered on a fresh database, and the agent checking session
 * tokens with the server's key. Returns the teardown. */
export default async function globalSetup() {
  mkdirSync(BIN_DIR, { recursive: true })
  mkdirSync(LOG_DIR, { recursive: true })

  const agentDir = path.join(REPO, 'agent')
  execFileSync('go', ['build', '-o', path.join(BIN_DIR, 'agent'), './cmd/agent'], { cwd: agentDir, stdio: 'inherit' })
  execFileSync('go', ['build', '-o', path.join(BIN_DIR, 'sitlpilot'), './cmd/sitlpilot'], { cwd: agentDir, stdio: 'inherit' })
  process.env.SITLPILOT_BIN = path.join(BIN_DIR, 'sitlpilot')

  // First build compiles ArduPilot (10–20 min); later ones are cached.
  execFileSync('docker', ['compose', 'up', '-d', '--build'], { cwd: path.join(REPO, 'sim'), stdio: 'inherit' })
  await waitForPort(5760, 60_000)

  // Keys and database for this run only.
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cellular-drone-e2e-sitl-data-'))
  const droneKey = path.join(dataDir, 'drone.key')
  const serverEnv = {
    DB_PATH: path.join(dataDir, 'server.db'),
    SESSION_SIGNING_KEY_FILE: path.join(dataDir, 'session-signing.key'),
    ADMIN_USERNAME: E2E_USER.username,
    ADMIN_PASSWORD: E2E_USER.password,
    COOKIE_SECURE: 'false',
  }
  const serverDir = path.join(REPO, 'server')
  const tsx = path.join(serverDir, 'node_modules', '.bin', 'tsx')
  const cli = (...args: string[]) =>
    execFileSync(tsx, ['src/cli.ts', ...args], { cwd: serverDir, env: { ...process.env, ...serverEnv }, encoding: 'utf8' }).trim()
  const dronePublicKey = execFileSync(path.join(BIN_DIR, 'agent'), ['-key', droneKey, '-print-key'], { encoding: 'utf8' }).trim()
  cli('drone:add', 'drone-1', dronePublicKey)
  const serverPublicKey = cli('keys:show')

  // tsx directly rather than `npm start`: killing npm leaves its tsx child running.
  const server = start('server', tsx, ['src/index.ts'], serverDir, serverEnv)
  await waitForPort(8788, 30_000)
  const agent = start(
    'agent',
    path.join(BIN_DIR, 'agent'),
    [
      '-fc', 'tcp:127.0.0.1:5760', '-video-cmd', '', '-stun', '', '-vehicle', 'drone-1', '-flight-log-dir', LOG_DIR,
      '-key', droneKey, '-server-pubkey', serverPublicKey,
    ],
    agentDir,
  )

  return async () => {
    agent.kill('SIGTERM')
    server.kill('SIGTERM')
    execFileSync('docker', ['compose', 'stop'], { cwd: path.join(REPO, 'sim'), stdio: 'inherit' })
  }
}
