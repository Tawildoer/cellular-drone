import { expect, test, type Browser } from '@playwright/test'
import {
  arm,
  connectToDrone,
  hold,
  pilotMovesSwitchTo,
  restartSitl,
  seedMission,
  TEST_MISSION,
  tile,
  waitForAltitude,
} from './helpers'

/**
 * The whole operator workflow through the real stack, against ArduPlane
 * SITL: browser → WebRTC → agent → MAVLink. Checks the mission the planner
 * shows is the one ArduPilot actually holds, then flies it.
 */
/** Another operator opening the app in their own browser, with nothing
 * saved locally, just watching: they must see the mission the vehicle is
 * flying (fetched from it), not an empty map. */
async function viewerSeesMission(browser: Browser, name: string) {
  const viewer = await browser.newContext()
  const page = await viewer.newPage()
  await connectToDrone(page)
  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 30_000 })
  await viewer.close()
}

test('plan, upload, fly, pause, resume, RTL and land', async ({ page, browser }) => {
  restartSitl()
  await seedMission(page)
  await connectToDrone(page)

  // That the vehicle then holds it is checked by the viewer steps below,
  // which read the mission back from the vehicle.
  await test.step('saving in the planner uploads it', async () => {
    await page.getByRole('button', { name: 'Plan mission' }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForTimeout(5_000) // upload with MAVLink retries
    await expect(page.getByText(/Not sent to vehicle/)).toBeHidden()
    await page.getByRole('button', { name: 'Exit planning' }).click()
  })

  await test.step('arm and start: VTOL takeoff in AUTO', async () => {
    await arm(page)
    await hold(page.getByRole('button', { name: 'Hold to start mission' }))
    await expect(tile(page, 'Flight mode')).toHaveText('AUTO')
    await waitForAltitude(page, 30)
  })

  await test.step('transitions to fixed-wing on the way to the waypoint', async () => {
    await expect(tile(page, 'VTOL state')).toHaveText('FW', { timeout: 90_000 })
  })

  await test.step('an operator joining mid-flight sees the mission', async () => {
    await viewerSeesMission(browser, TEST_MISSION.name)
  })

  await test.step('pause loiters, resume goes back to AUTO', async () => {
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(tile(page, 'Flight mode')).toHaveText(/^(LOITER|QLOITER)$/)
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await expect(tile(page, 'Flight mode')).toHaveText('AUTO')
  })

  await test.step('RTL brings it home and lands vertically', async () => {
    await hold(page.getByRole('button', { name: 'Hold for RTL' }))
    await expect(tile(page, 'Flight mode')).toHaveText('RTL')
    // "Hold for RTL" disables itself once the vehicle reports landed.
    await expect(page.getByRole('button', { name: 'Hold for RTL' })).toBeDisabled({ timeout: 6 * 60_000 })
    await expect(tile(page, 'Altitude AGL')).toHaveText(/^-?[01] m$/)
  })

  await test.step('disarms itself once landed', async () => {
    // ArduPlane disarms a few seconds after a VTOL landing ("Land complete",
    // then "Throttle disarmed"); the browser only has to if it hasn't.
    await expect(tile(page, 'Armed')).toHaveText('Disarmed', { timeout: 30_000 }).catch(async () => {
      await hold(page.getByRole('button', { name: 'Hold to disarm' }))
      await expect(tile(page, 'Armed')).toHaveText('Disarmed')
    })
  })

  await test.step('after landing, the mission is still on the vehicle and shown', async () => {
    // ArduPilot keeps a finished mission until it's replaced.
    await viewerSeesMission(browser, TEST_MISSION.name)
  })
})

/**
 * ADR-0008: the local radio always wins. The "pilot" (cmd/sitlpilot -switch,
 * moving SITL's simulated mode switch) takes over mid-mission; the browser
 * shows it and the agent refuses browser commands until the switch is back
 * at AUTO.
 */
test('RC takeover blocks browser commands until the pilot hands back', async ({ page }) => {
  restartSitl()
  await seedMission(page)
  await connectToDrone(page)

  await test.step('fly the mission until cruising fixed-wing', async () => {
    await arm(page)
    await hold(page.getByRole('button', { name: 'Hold to start mission' }))
    await expect(tile(page, 'Flight mode')).toHaveText('AUTO')
    // Climb first: ArduPlane reports VTOL state FW on the ground in a
    // fixed-wing mode, so "FW" alone can be true before the VTOL takeoff.
    await waitForAltitude(page, 30)
    await expect(tile(page, 'VTOL state')).toHaveText('FW', { timeout: 2 * 60_000 })
  })

  const banner = page.getByText(/RC override active/)
  await test.step('the pilot flips the switch to FBWA: the browser shows the override', async () => {
    pilotMovesSwitchTo('FBWA')
    await expect(banner).toBeVisible()
    await expect(tile(page, 'Flight mode')).toHaveText('FBWA')
  })

  await test.step('browser commands are refused while the pilot has control', async () => {
    await hold(page.getByRole('button', { name: 'Hold for RTL' }))
    await expect(page.getByRole('alert').filter({ hasText: 'blocked_rc_override' })).toBeVisible()
    await expect(tile(page, 'Flight mode')).toHaveText('FBWA')
  })

  await test.step('the pilot hands back, switch to AUTO: the override clears', async () => {
    pilotMovesSwitchTo('release')
    await expect(banner).toBeHidden()
    await expect(tile(page, 'Flight mode')).toHaveText('AUTO')
  })

  await test.step('browser commands work again', async () => {
    await hold(page.getByRole('button', { name: 'Hold for RTL' }))
    await expect(tile(page, 'Flight mode')).toHaveText('RTL')
  })
})

/**
 * ARCHITECTURE.md, RC override pre-flight: a mission starts only with the
 * radio's mode switch at AUTO, so the pilot takes over by moving it. The
 * checklist shows where it is, and nothing goes ahead until it's back.
 */
test('a mission only starts with the RC mode switch at AUTO', async ({ page }) => {
  restartSitl()
  await seedMission(page)
  await connectToDrone(page)
  const switchCheck = page.getByText(/RC mode switch at AUTO \(now FBWA\)/)

  // The browser's checklist gates arming (and so starting); the agent
  // refuses a start on its own too (internal/fc, rcPreflightLocked tests).
  await test.step('switch off AUTO: the checklist says so and arming is blocked', async () => {
    pilotMovesSwitchTo('FBWA')
    await expect(switchCheck).toBeVisible()
    await expect(page.getByRole('button', { name: 'Hold to arm' })).toBeDisabled()
  })

  await test.step('switch back to AUTO: arm and start go ahead', async () => {
    pilotMovesSwitchTo('release')
    await expect(switchCheck).toBeHidden()
    await arm(page)
    await hold(page.getByRole('button', { name: 'Hold to start mission' }))
    await expect(tile(page, 'Flight mode')).toHaveText('AUTO')
    await waitForAltitude(page, 10)
  })
})

