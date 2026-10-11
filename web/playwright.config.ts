import { defineConfig, devices } from '@playwright/test'

/**
 * The smoke test against the in-browser mock drone (`npm run e2e`): the
 * whole operator workflow, no backend. It starts its own dev server on
 * 5175 with a plain mock drone that starts on the ground (config.ts,
 * VITE_MOCK_GROUND_DRONE) flying 5× fast, leaving any dev server on 5173
 * alone. Desktop Chrome only until the phone layout is built.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 3 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:5175',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5175 --strictPort',
    url: 'http://localhost:5175',
    reuseExistingServer: false,
    env: {
      // Process env beats .env.local.
      VITE_VEHICLE_LINK: 'mock',
      VITE_MOCK_GROUND_DRONE: 'true',
      VITE_MOCK_TIME_SCALE: '5',
    },
  },
})
