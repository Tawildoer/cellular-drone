// Copies the built web UI (the files its app manifest lists) into
// app-bundle/, the copy the Mac app ships with and starts from before any
// over-the-air update (ADR-0027). Run after `npm --prefix ../web run build`
// and `build:manifest`.
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

const WEB_DIST = new URL('../../web/dist/', import.meta.url).pathname
const OUT = new URL('../app-bundle/', import.meta.url).pathname
const manifest = JSON.parse(readFileSync(join(WEB_DIST, 'app-manifest.json'), 'utf8'))

rmSync(OUT, { recursive: true, force: true })
for (const file of [...manifest.files.map((f) => f.path), 'app-manifest.json']) {
  mkdirSync(dirname(join(OUT, file)), { recursive: true })
  cpSync(join(WEB_DIST, file), join(OUT, file))
}
console.log(`app-bundle: ${manifest.version}, ${manifest.files.length} files`)
