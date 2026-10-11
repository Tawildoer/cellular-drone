import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * The operator workflow end to end against the mock drone (docs/PLAN.md,
 * 1a): log in, plan a mission on the map, save (which uploads it), arm,
 * start, pause, resume, RTL and land. The same steps e2e-sitl flies against
 * ArduPlane; this one needs nothing but the web app, so it runs anywhere.
 */

/** The value of a HUD stat tile, by its label. */
function tile(page: Page, label: string): Locator {
  return page
    .locator('span.hud-label', { hasText: new RegExp(`^${label}$`) })
    .locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]')
    .locator('.hud-value')
}

/** Press and hold a hold-to-confirm button past its 0.9 s threshold. */
async function hold(button: Locator) {
  await expect(button).toBeEnabled()
  await button.hover()
  await button.page().mouse.down()
  await button.page().waitForTimeout(1300)
  await button.page().mouse.up()
}

async function altitudeM(page: Page): Promise<number> {
  return parseInt((await tile(page, 'Altitude AGL').textContent()) ?? '0', 10)
}

test('log in, plan, upload, arm, start, pause, resume, RTL and land', async ({ page }) => {
  await test.step('log in and connect to the drone', async () => {
    await page.goto('/')
    // Dev builds sign in automatically; fall back to the form if not.
    const drone = page.getByRole('button', { name: /Drone 1/ })
    const username = page.getByLabel(/username/i)
    await expect(drone.or(username)).toBeVisible()
    if (await username.isVisible()) {
      await username.fill(process.env.VITE_DEV_USERNAME ?? 'operator')
      await page.getByLabel(/password/i).fill(process.env.VITE_DEV_PASSWORD ?? 'changeme')
      await page.getByRole('button', { name: /sign in|log in/i }).click()
    }
    await drone.click()
    await expect(tile(page, 'Armed')).toHaveText('Disarmed')
  })

  await test.step('plan: two waypoints from map clicks, then save', async () => {
    await page.getByRole('button', { name: 'Plan mission' }).click()
    const canvas = page.locator('canvas.maplibregl-canvas').first()
    await expect(canvas).toBeVisible()
    // The mock has a GPS fix within two simulated seconds, and the map
    // then centres on the drone, so the clicks land near home.
    await page.waitForTimeout(2_000)
    const box = (await canvas.boundingBox())!
    // Right of centre, clear of the planner's panels on the left.
    await page.mouse.click(box.x + box.width * 0.65, box.y + box.height * 0.35)
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.5)
    // A remove button per waypoint (takeoff and RTL can't be removed).
    await expect(page.getByRole('button', { name: /^Remove item \d$/ })).toHaveCount(2)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText(/Not sent to vehicle/)).toBeHidden()
    await page.getByRole('button', { name: 'Exit planning' }).click()
  })

  await test.step('arm and start: VTOL takeoff in AUTO', async () => {
    await hold(page.getByRole('button', { name: 'Hold to arm' }))
    await expect(tile(page, 'Armed')).toHaveText('Armed')
    await hold(page.getByRole('button', { name: 'Hold to start mission' }))
    await expect(tile(page, 'Flight mode')).toHaveText('AUTO')
    await expect.poll(() => altitudeM(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(20)
  })

  await test.step('pause loiters, resume goes back to AUTO', async () => {
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(tile(page, 'Flight mode')).toHaveText(/^(LOITER|QLOITER)$/)
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await expect(tile(page, 'Flight mode')).toHaveText('AUTO')
  })

  await test.step('RTL brings it home and lands', async () => {
    await hold(page.getByRole('button', { name: 'Hold for RTL' }))
    await expect(tile(page, 'Flight mode')).toHaveText(/^(RTL|QLAND)$/)
    // "Hold for RTL" disables itself once the vehicle reports landed.
    await expect(page.getByRole('button', { name: 'Hold for RTL' })).toBeDisabled({ timeout: 2 * 60_000 })
  })
})
