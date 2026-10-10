import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

/** The deployed UI's file list (web/scripts/write-app-manifest.mjs). */
export interface BundleManifest {
  schema: 1
  version: string
  /** Build time, epoch ms: newer wins. */
  builtAt: number
  files: { path: string; size: number; sha256: string }[]
}

/** A copy of the UI on disk: the one shipped in the app, or one downloaded. */
export interface Bundle {
  dir: string
  manifest: BundleManifest
}

const MANIFEST = 'app-manifest.json'
/** Downloaded versions kept, newest first: the one in use and one before. */
const KEEP_CACHED = 2

function isManifest(value: unknown): value is BundleManifest {
  const m = value as BundleManifest
  return !!m && m.schema === 1 && typeof m.version === 'string' && typeof m.builtAt === 'number' && Array.isArray(m.files)
}

/** A bundle on disk, if its manifest is readable and every file it lists is
 * there at the right size. (Contents were checked when it was downloaded.) */
export function readBundle(dir: string): Bundle | null {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8'))
    if (!isManifest(manifest)) return null
    for (const f of manifest.files) {
      const full = join(dir, f.path)
      if (!existsSync(full) || statSync(full).size !== f.size) return null
    }
    return { dir, manifest }
  } catch {
    return null
  }
}

export function cachedBundles(root: string): Bundle[] {
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((name) => !name.startsWith('.'))
    .map((name) => readBundle(join(root, name)))
    .filter((b): b is Bundle => b !== null)
}

export function newest(bundles: (Bundle | null)[]): Bundle | null {
  return bundles.filter((b): b is Bundle => b !== null).sort((a, b) => b.manifest.builtAt - a.manifest.builtAt)[0] ?? null
}

/** A path inside the bundle, or null if the request tries to leave it. */
export function fileIn(bundle: Bundle, requestPath: string): string | null {
  const full = resolve(bundle.dir, requestPath)
  return full.startsWith(resolve(bundle.dir) + sep) ? full : null
}

type Fetch = (url: string) => Promise<Response>

/** The deployed site's manifest, never from a cache. */
export async function fetchManifest(fetch: Fetch, origin: string): Promise<BundleManifest> {
  const res = await fetch(`${origin}/${MANIFEST}?t=${Date.now()}`)
  if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`)
  const manifest: unknown = await res.json()
  if (!isManifest(manifest)) throw new Error('manifest: not a schema 1 app manifest')
  return manifest
}

/**
 * Downloads every file a manifest lists from the deployed site, checking
 * each one's size and SHA-256, into a folder of its own under `root`. Only
 * a complete, verified copy is moved into place; anything else is thrown
 * away. Older downloads beyond KEEP_CACHED are removed.
 */
export async function download(fetch: Fetch, origin: string, manifest: BundleManifest, root: string): Promise<Bundle> {
  const name = `${manifest.builtAt}-${manifest.version.replace(/[^a-zA-Z0-9.+-]/g, '_')}`
  const final = join(root, name)
  const partial = join(root, `.partial-${name}-${process.pid}`)
  rmSync(partial, { recursive: true, force: true })
  try {
    for (const f of manifest.files) {
      const target = resolve(partial, f.path)
      if (!target.startsWith(resolve(partial) + sep)) throw new Error(`${f.path}: outside the bundle`)
      const res = await fetch(`${origin}/${f.path}`)
      if (!res.ok) throw new Error(`${f.path}: HTTP ${res.status}`)
      const bytes = Buffer.from(await res.arrayBuffer())
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (bytes.length !== f.size || sha256 !== f.sha256) throw new Error(`${f.path}: doesn't match the manifest`)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, bytes)
    }
    writeFileSync(join(partial, MANIFEST), JSON.stringify(manifest, null, 2))
    rmSync(final, { recursive: true, force: true })
    renameSync(partial, final)
  } catch (e) {
    rmSync(partial, { recursive: true, force: true })
    throw e
  }
  prune(root)
  const bundle = readBundle(final)
  if (!bundle) throw new Error('downloaded bundle failed to read back')
  return bundle
}

function prune(root: string) {
  const all = cachedBundles(root).sort((a, b) => b.manifest.builtAt - a.manifest.builtAt)
  for (const old of all.slice(KEEP_CACHED)) rmSync(old.dir, { recursive: true, force: true })
}
