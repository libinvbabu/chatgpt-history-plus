// Only for the promo recording (npm run promo:record); the e2e suite uses the root config.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'record.spec.ts',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: '../../.promo/test-results',
})
