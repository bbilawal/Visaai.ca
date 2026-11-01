// Named .mts on purpose: @vitejs/plugin-react v5 is ESM-only, and this package
// has no "type": "module", so a .ts config gets loaded through require() and
// fails with "ESM file cannot be loaded by `require`". The .mts extension forces
// the ESM loader without making the whole Next app ESM.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Unit/component tests only. Playwright e2e live under e2e/ and are excluded.
    include: ['**/*.test.{ts,tsx}'],
    exclude: [
      'node_modules/**',
      '.next/**',
      'e2e/**',
    ],
  },
})
