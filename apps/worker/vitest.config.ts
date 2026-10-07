import { defineConfig } from "vitest/config"

// Tests run in Node against local D1 and R2 from wrangler's getPlatformProxy (workerd under the
// hood), through the real Worker fetch handler.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 },
})
