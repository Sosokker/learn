import { defineConfig } from "vitest/config"

// Tests run in Node against Miniflare's in-memory D1 and R2 (see test/support.ts); nothing on
// disk, no network.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
