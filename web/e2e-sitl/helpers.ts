import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'
import { E2E_USER, REPO } from './global-setup'

/** SITL home (sim/docker-compose.yml). */
export const HOME = { lat: -37.861, lon: 145.062 }

const M_PER_DEG_LAT = 111_320

function offset(eastM: number, northM: number) {
  return {
    lat: HOME.lat + northM / M_PER_DEG_LAT,
    lon: HOME.lon + eastM / (M_PER_DEG_LAT * Math.cos((HOME.lat * Math.PI) / 180)),
  }
}

/** A short mission near home: takeoff, a waypoint, one loiter lap, RTL. */
export const TEST_MISSION = {
  id: 'e2e-sitl',
  name: 'E2E SITL',
  items: [
    { type: 'vtolTakeoff', altM: 40 },
    { type: 'waypoint', ...offset(0, 500), altM: 60 },
    { type: 'loiter', ...offset(500, 500), altM: 60, radiusM: 80, turns: 1 },
    { type: 'returnToLaunch' },
  ],
  createdAt: 1,
  updatedAt: 1,
}

/** Restarts SITL so the test starts landed and disarmed at home. The agent
 * reconnects to it by itself. */
export function restartSitl() {
  execFileSync('docker', ['compose', 'up', '-d', '--force-recreate'], { cwd: path.join(REPO, 'sim'), stdio: 'inherit' })
}

function sitlpilot(args: string[]) {
  const bin = process.env.SITLPILOT_BIN
  if (!bin) throw new Error('SITLPILOT_BIN not set: run through playwright.sitl.config.ts')
  execFileSync(bin, args, { stdio: 'inherit' })
}

/** The SITL "RC pilot" moving the radio's mode switch (cmd/sitlpilot
 * -switch): to a mode's position, or released back to SITL's own simulated
 * radio, which sits at AUTO. */
export function pilotMovesSwitchTo(to: 'FBWA' | 'LOITER' | 'QLOITER' | 'RTL' | 'release') {
  sitlpilot(['-switch', to])
}

/** Signs the page's browser context in and saves the test mission on the
 * server as the most recent one, which the app uploads to the (disarmed)
 * vehicle when it connects (useFlightMission). The page then opens signed in. */
export async function seedMission(page: Page) {
  const login = await page.request.post('/api/login', { data: E2E_USER })
  expect(login.ok()).toBe(true)
  const saved = await page.request.post('/api/missions', { data: TEST_MISSION })
  expect(saved.ok()).toBe(true)
}

export async function connectToDrone(page: Page) {
  await page.goto('/')
  // Already signed in if seedMission ran (a cookie in this context); else the form.
  const droneButton = page.getByRole('button', { name: /Drone 1/ })
  const username = page.getByLabel(/username/i)
  await expect(droneButton.or(username)).toBeVisible()
  if (await username.isVisible()) {
    await username.fill(E2E_USER.username)
    await page.getByLabel(/password/i).fill(E2E_USER.password)
    await page.getByRole('button', { name: /sign in|log in/i }).click()
  }
  await droneButton.click()
  // Telemetry arriving over WebRTC from the agent fills the HUD.
  await expect(tile(page, 'Flight mode')).not.toHaveText('', { timeout: 60_000 })
}

/** The value of a HUD stat tile, by its label. */
export function tile(page: Page, label: string): Locator {
  return page
    .locator('span.hud-label', { hasText: new RegExp(`^${label}$`) })
    .locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]')
    .locator('.hud-value')
}

export async function altitudeM(page: Page): Promise<number> {
  return parseInt((await tile(page, 'Altitude AGL').textContent()) ?? '0', 10)
}

/** Press and hold a hold-to-confirm button past its 0.9 s threshold. */
export async function hold(button: Locator) {
  await expect(button).toBeEnabled()
  await button.hover()
  await button.page().mouse.down()
  await button.page().waitForTimeout(1300)
  await button.page().mouse.up()
}

/** Arms, retrying while ArduPilot's own pre-arm checks settle after boot
 * (EKF, gyro consistency): the UI's checklist can pass before they do. */
export async function arm(page: Page) {
  const armButton = page.getByRole('button', { name: 'Hold to arm' })
  await expect(armButton).toBeEnabled({ timeout: 3 * 60_000 })
  await expect(async () => {
    if ((await tile(page, 'Armed').textContent()) !== 'Armed') await hold(armButton)
    await expect(tile(page, 'Armed')).toHaveText('Armed', { timeout: 5_000 })
  }).toPass({ timeout: 3 * 60_000, intervals: [3_000] })
}

export async function waitForAltitude(page: Page, atLeastM: number, timeoutMs = 90_000) {
  await expect.poll(() => altitudeM(page), { timeout: timeoutMs, intervals: [1_000] }).toBeGreaterThanOrEqual(atLeastM)
}
