import { defineConfig, devices } from "@playwright/test"

// One target: the local dev server (Vite + the Worker, D1 and R2 in Miniflare) on the port
// BETTER_AUTH_URL names. seed:local migrates and publishes content/ as @learn, so the guide,
// its /c/ bodies and the "new" feed exist. It is idempotent, so a reused server is fine.
const port = 5187
export const appOrigin = `http://localhost:${port}`

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  // One dev server and one shared local D1: run serially so tests never race on state.
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  reporter: [["list"]],
  use: {
    baseURL: appOrigin,
    // The app picks its language from navigator.languages when nothing is stored.
    locale: "en-US",
    trace: "retain-on-failure",
  },
  // Uses the Playwright-managed Chromium for @playwright/test 1.63 (revision 1243). Install it
  // once with `bunx playwright install chromium` if it is missing.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run seed:local && bun run dev",
    cwd: "..",
    url: appOrigin,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
})
