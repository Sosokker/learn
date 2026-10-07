import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    // Must run before the React plugin so route files are code-split before JSX is compiled.
    tanstackRouter({
      target: "react",
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
    // Runs the Worker (API, auth, /c/ bodies) inside Vite, so `bun run dev` is the whole app.
    // Shares local D1/R2 state with `bun run db:migrate:local` and `bun run seed:local`.
    cloudflare({
      configPath: "../worker/wrangler.jsonc",
      persistState: { path: "../worker/.wrangler/state" },
    }),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
})
