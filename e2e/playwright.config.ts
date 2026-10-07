import { defineConfig, devices } from "@playwright/test"

// Runs against `bun run dev` (Vite + the Worker on local D1/R2). The global setup migrates and
// seeds the local database and creates a signed-in test user.
export default defineConfig({
  testDir: "tests",
  outputDir: "artifacts/results",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  globalSetup: "./tests/global-setup.ts",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    // Set PW_CHROMIUM to use a preinstalled browser whose build differs from this Playwright's,
    // e.g. /opt/pw-browsers/chromium in Claude Code cloud sessions.
    ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
  },
  webServer: {
    command: "bun run --cwd ../apps/web dev --port 5173 --strictPort",
    url: "http://localhost:5173/api/health",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 } } },
  ],
})
