import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Browser integration tests start real Chrome processes; parallel files
    // contend for startup resources on small CI runners.
    fileParallelism: false,
  },
})
