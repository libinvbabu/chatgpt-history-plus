import { defineConfig } from 'vitest/config'

// A DST-observing zone, so calendar maths that assumes 24h days fails loudly.
process.env.TZ = 'America/New_York'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
})
