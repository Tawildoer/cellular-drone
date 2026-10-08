import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
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

function start(name: string, command: string, args: string[], cwd: string): ChildProcess {
  const log = createWriteStream(path.join(LOG_DIR, `${name}.log`))
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout?.pipe(log)
  child.stderr?.pipe(log)
  return child
}

/** Builds the Go tools, makes sure the SITL image exists, then starts the
 * signalling server and the agent (pointed at SITL). Returns the teardown. */
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

  // tsx directly rather than `npm start`: killing npm leaves its tsx child running.
  const serverDir = path.join(REPO, 'server')
  const server = start('server', path.join(serverDir, 'node_modules', '.bin', 'tsx'), ['src/index.ts'], serverDir)
  await waitForPort(8788, 30_000)
  const agent = start(
    'agent',
    path.join(BIN_DIR, 'agent'),
    ['-fc', 'tcp:127.0.0.1:5760', '-video-cmd', '', '-stun', '', '-vehicle', 'drone-1', '-flight-log-dir', LOG_DIR],
    agentDir,
  )

  return async () => {
    agent.kill('SIGTERM')
    server.kill('SIGTERM')
    execFileSync('docker', ['compose', 'stop'], { cwd: path.join(REPO, 'sim'), stdio: 'inherit' })
  }
}
