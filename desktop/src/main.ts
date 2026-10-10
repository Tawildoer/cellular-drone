import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell, type MenuItemConstructorOptions } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cachedBundles, download, fetchManifest, fileIn, newest, readBundle, type Bundle } from './bundles'
import { loadSettings, saveSettings, type Settings } from './settings'

/**
 * The Mac app (ADR-0027): a window onto the same UI as the web app, served
 * from a copy on disk so it starts without the internet, and kept current
 * over the air from the deployed site. A new version downloads in the
 * background and is offered with "Update ready · Reload"; it never reloads
 * by itself, so an update can't interrupt a flight.
 *
 * For development, Develop → Live from Local Dev Server loads the running
 * Vite server instead, so every save shows up at once (hot reload), and
 * over-the-air updates pause until it's switched off.
 */

/** Where updates come from: the deployed site (override for testing). */
const UPDATE_ORIGIN = process.env.DRONE_UPDATE_ORIGIN ?? 'https://drone.tomwildoer.com'
/** The UI's own origin: fixed, so its saved missions and settings
 * (browser storage) carry across updates. */
const SCHEME = 'app'
const HOST = 'cellular-drone'
const UI_URL = `${SCHEME}://${HOST}/index.html`
const APP_NAME = 'Ground Control'
/** The Vite dev server (web/: `npm run dev`). */
const DEV_URL = process.env.DRONE_DEV_URL ?? 'http://localhost:5173'
const CHECK_EVERY_MS = 10 * 60_000
/** Coming back to the app checks too, but not more often than this. */
const MIN_CHECK_GAP_MS = 60_000

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
])

let active: Bundle
/** Downloaded and verified, waiting for the operator to reload into it. */
let pending: Bundle | null = null
let window: BrowserWindow | null = null
let settings: Settings
let checking = false
let lastCheckMs = 0

function bundledDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'app-bundle') : join(__dirname, '..', 'app-bundle')
}

function cacheRoot(): string {
  return join(app.getPath('userData'), 'bundles')
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** Pages the window may show: the app's own, or the dev server when live. */
function isOwnPage(url: string): boolean {
  return url.startsWith(`${SCHEME}://${HOST}/`) || (settings.liveFromDevServer && url.startsWith(DEV_URL))
}

function load() {
  if (!window) return
  void window.loadURL(settings.liveFromDevServer ? DEV_URL : UI_URL)
  window.setTitle(settings.liveFromDevServer ? `${APP_NAME} (live from ${DEV_URL})` : APP_NAME)
}

function setLiveFromDevServer(on: boolean) {
  settings = { ...settings, liveFromDevServer: on }
  saveSettings(settingsFile(), settings)
  buildMenu()
  load()
}

function buildMenu() {
  const develop: MenuItemConstructorOptions = {
    label: 'Develop',
    submenu: [
      {
        label: 'Live from Local Dev Server',
        type: 'checkbox',
        checked: settings.liveFromDevServer,
        accelerator: 'CmdOrCtrl+Shift+D',
        click: (item) => setLiveFromDevServer(item.checked),
      },
      { label: `(${DEV_URL}: run \`npm run dev\` in web/)`, enabled: false },
      { type: 'separator' },
      {
        label: 'Check for Update Now',
        enabled: !settings.liveFromDevServer,
        click: () => {
          lastCheckMs = 0
          void checkForUpdate()
        },
      },
      { role: 'toggleDevTools' },
    ],
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
      },
      develop,
      { role: 'windowMenu' },
    ]),
  )
}

/** Serves the active bundle. Unknown paths fall back to index.html. */
function serve(request: Request): Promise<Response> {
  const path = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html'
  let file = fileIn(active, path)
  if (!file || !existsSync(file) || statSync(file).isDirectory()) file = join(active.dir, 'index.html')
  return net.fetch(pathToFileURL(file).toString())
}

async function checkForUpdate() {
  // Live from the dev server, the bundles aren't in use: nothing to update.
  if (settings.liveFromDevServer || checking || Date.now() - lastCheckMs < MIN_CHECK_GAP_MS) return
  checking = true
  lastCheckMs = Date.now()
  try {
    const manifest = await fetchManifest((url) => net.fetch(url, { cache: 'no-store' }), UPDATE_ORIGIN)
    const current = pending ?? active
    if (manifest.builtAt <= current.manifest.builtAt) return
    pending = await download((url) => net.fetch(url, { cache: 'no-store' }), UPDATE_ORIGIN, manifest, cacheRoot())
    window?.webContents.send('desktop:update-ready', { version: pending.manifest.version })
  } catch (e) {
    // Offline, or the site mid-deploy: the next check tries again.
    console.warn('update check failed:', (e as Error).message)
  } finally {
    checking = false
  }
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0a0a12',
    title: APP_NAME,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  // The UI stays on its own origin; any other link opens in the browser.
  window.webContents.on('will-navigate', (event, url) => {
    if (!isOwnPage(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // The dev server isn't running: say so, and go back to the bundled UI.
  window.webContents.on('did-fail-load', (_event, _code, description, url, isMainFrame) => {
    if (!isMainFrame || !settings.liveFromDevServer || !url.startsWith(DEV_URL)) return
    void dialog.showMessageBox({
      type: 'warning',
      message: `The dev server at ${DEV_URL} isn't answering (${description}).`,
      detail: 'Start it with `npm run dev` in cellular-drone/web, then turn Develop → Live from Local Dev Server back on. Showing the installed version for now.',
    })
    setLiveFromDevServer(false)
  })
  // Keep the title saying which UI this is; the page's <title> would
  // otherwise replace it on every load.
  window.on('page-title-updated', (event) => event.preventDefault())
  window.on('focus', () => void checkForUpdate())
  window.on('closed', () => (window = null))
  load()
}

app.whenReady().then(() => {
  const start = newest([readBundle(bundledDir()), ...cachedBundles(cacheRoot())])
  if (!start) {
    console.error(`No UI bundle found in ${bundledDir()}: run \`npm run bundle\` first.`)
    app.quit()
    return
  }
  active = start
  settings = loadSettings(settingsFile())
  protocol.handle(SCHEME, serve)
  buildMenu()

  ipcMain.handle('desktop:info', () => ({
    uiVersion: active.manifest.version,
    uiBuiltAt: active.manifest.builtAt,
    appVersion: app.getVersion(),
    updateReady: pending ? pending.manifest.version : null,
    liveFrom: settings.liveFromDevServer ? DEV_URL : null,
  }))
  ipcMain.handle('desktop:apply-update', () => {
    if (!pending) return false
    active = pending
    pending = null
    window?.webContents.reload()
    return true
  })

  // Running from the repo (`npm start`), show the app's own icon in the Dock.
  if (!app.isPackaged) app.dock?.setIcon(join(__dirname, '..', 'build', 'icon.png'))

  createWindow()
  setTimeout(() => void checkForUpdate(), 3000)
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
