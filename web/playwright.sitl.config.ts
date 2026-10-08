import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests against the real stack: Chrome → web app → WebRtcLink →
 * signalling server → agent (-fc) → ArduPlane SITL in Docker. Slow (a few
 * minutes per flight) and needs Docker and Go, so it's its own suite:
 *
 *   npm run e2e:sitl
 *
 * global-setup.ts builds and starts the server and agent; each test restarts
 * SITL so it starts landed and disarmed at home.
 */
export default defineConfig({
  testDir: './e2e-sitl',
  fullyParallel: false,
  workers: 1,
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-sitl' }]],
  globalSetup: './e2e-sitl/global-setup.ts',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    // Its own port, so a dev server already running on 5173 (mock build) is left alone.
    command: 'npm run dev -- --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: false,
    env: {
      // Process env beats .env.local, so this overrides its mock setting.
      VITE_VEHICLE_LINK: 'webrtc',
      VITE_SIGNAL_URL: 'ws://localhost:8788/signal',
      VITE_ICE_URLS: '', // same machine: host candidates only
    },
  },
})
