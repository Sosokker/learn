import "./app.css"
import { I18nProvider, ToastProvider } from "@app/ui"
import { QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { NotFound } from "./components/NotFound.tsx"
import { queryClient } from "./lib/queries.ts"
import { routeTree } from "./routeTree.gen.ts"

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  // Data comes from TanStack Query; the router shouldn't cache loader results a second time.
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  defaultNotFoundComponent: NotFound,
  // Lesson links are /@handle/slug. Vite's dev server reserves "/@" and redirects to "/%40…", and
  // some apps encode "@" when sharing a link, so read %40 at the start of the path as "@".
  rewrite: {
    input: ({ url }) => {
      if (!/^\/%40/i.test(url.pathname)) return undefined
      url.pathname = url.pathname.replace(/^\/%40/i, "/@")
      return url
    },
  },
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

const root = document.getElementById("root")
if (root) {
  createRoot(root).render(
    <StrictMode>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </QueryClientProvider>
      </I18nProvider>
    </StrictMode>,
  )
}
