import { I18nProvider, TooltipProvider } from "@app/ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"
import { routeTree } from "./routeTree.gen.ts"

// Cloudflare's asset server answers a deep link to /@handle/slug with a 307 to /%40handle/slug
// (it re-encodes the path of the SPA fallback), and the router does not decode %40. Put the `@`
// back before the router reads the URL.
if (window.location.pathname.startsWith("/%40")) {
  const { pathname, search, hash } = window.location
  window.history.replaceState(window.history.state, "", `/@${pathname.slice(4)}${search}${hash}`)
}

// staleTime: data fetched in the last 30 s is shown without a refetch (tab switches, remounts,
// hover prefetch followed by a click).
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })

// Route loaders start their queries on link hover/focus ("intent"), so data and code load in
// parallel. preloadStaleTime 0: TanStack Query decides freshness, not the router's own cache.
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

const root = document.getElementById("root")
if (root === null) throw new Error("index.html is missing #root")

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
)
