import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Code the live vehicle link runs: the protocol, the links (the in-browser
 * mock drone included), and the domain and ArduPilot code they use. A link
 * made before an edit keeps running the old version, so hot-swapping these
 * left the drone and its decoder out of step with the UI (commands rejected
 * as malformed). Editing one reloads the page instead.
 */
const LIVE_LINK_CODE = /[\\/]src[\\/](protocol|link|domain|ardupilot)[\\/]/

function reloadOnLinkCodeChange(): Plugin {
  return {
    name: 'reload-on-link-code-change',
    hotUpdate({ file }) {
      if (this.environment.name !== 'client' || !LIVE_LINK_CODE.test(file)) return
      this.environment.hot.send({ type: 'full-reload' })
      return []
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // cloudflare() builds the Worker deploy config, but conflicts with Vitest's
  // own server (shared config via vitest/config), so it's excluded under test.
  plugins: [react(), tailwindcss(), reloadOnLinkCodeChange(), ...(process.env.VITEST ? [] : [cloudflare()])],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // The local console always lives at http://localhost:5173: fail rather
    // than drift to another port if it's taken. (e2e:sitl asks for 5174 on
    // purpose, so it can run beside this one.)
    port: 5173,
    strictPort: true,
    fs: {
      // The repo-level golden files (testdata/mission-translation) are shared
      // with the Go agent, so the translator tests read them from outside web/.
      allow: [__dirname, path.resolve(__dirname, '../testdata')],
    },
  },
  optimizeDeps: {
    // maplibre-gl's worker breaks under esbuild dep pre-bundling.
    exclude: ['maplibre-gl'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/e2e-sitl/**'],
  },
})
