import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  // cloudflare() builds the Worker deploy config, but conflicts with Vitest's
  // own server (shared config via vitest/config), so it's excluded under test.
  plugins: [react(), tailwindcss(), ...(process.env.VITEST ? [] : [cloudflare()])],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
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
