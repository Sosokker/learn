import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// `vite` (dev) runs the Worker (apps/worker) inside Vite with the Cloudflare plugin, so /api/* and
// /c/* hit the real Worker, D1 and R2 (local state) on the same origin as the SPA.
// `vite build` emits only the SPA into dist/; apps/worker bundles the Worker itself and serves
// dist/ as its static assets (wrangler.jsonc `assets.directory`).
export default defineConfig(({ command }) => ({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    ...(command === "serve"
      ? [
          cloudflare({
            configPath: "../worker/wrangler.jsonc",
            // Resolved against this folder, then `/v3` is appended: the same directory that
            // `bun run db:migrate:local` and `bun run seed:local` write (apps/worker/.wrangler/state).
            persistState: { path: "../worker/.wrangler/state" },
          }),
        ]
      : []),
  ],
  // The main chunk is React + the Effect runtime / HttpApi client; the lesson renderer is lazy.
  build: { chunkSizeWarningLimit: 700 },
  server: {
    // BETTER_AUTH_URL in apps/worker/.dev.vars names 5187, and the Worker refuses state-changing
    // requests from other origins, so fail instead of moving to another port. WEB_PORT overrides
    // it (then set BETTER_AUTH_URL in .dev.vars to match, or sign-in and uploads are refused).
    port: Number(process.env.WEB_PORT ?? 5187),
    strictPort: true,
  },
}))
