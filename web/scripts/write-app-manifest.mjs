// Lists the built UI for the Mac app's over-the-air updates (ADR-0027):
// every file it needs, with its SHA-256, so the app can fetch a new version
// from the deployed site and check each file before using it. Written into
// dist/ after the build, so `npm run deploy` publishes it with the site.
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const DIST = new URL('../dist/', import.meta.url).pathname
const MANIFEST = 'app-manifest.json'
// The docs, and Cloudflare's own files, aren't part of the app.
const SKIP = [/^docs\//, /^wrangler\.json$/, /^\.assetsignore$/, new RegExp(`^${MANIFEST.replace('.', '\\.')}$`)]

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

function gitVersion() {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
    const dirty = execSync('git status --porcelain -- .', { encoding: 'utf8' }).trim() !== ''
    return dirty ? `${sha}+local` : sha
  } catch {
    return 'unknown'
  }
}

const files = walk(DIST)
  .map((full) => relative(DIST, full).split(sep).join('/'))
  .filter((path) => !SKIP.some((re) => re.test(path)))
  .sort()
  .map((path) => {
    const bytes = readFileSync(join(DIST, path))
    return { path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  })

const manifest = { schema: 1, version: gitVersion(), builtAt: Date.now(), files }
writeFileSync(join(DIST, MANIFEST), JSON.stringify(manifest, null, 2) + '\n')
console.log(`app manifest: ${manifest.version}, ${files.length} files`)
