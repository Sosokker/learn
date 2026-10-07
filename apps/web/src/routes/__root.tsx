import type { QueryClient } from "@tanstack/react-query"
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router"
import { NotFound } from "../not-found.tsx"
import { categoriesQuery } from "../queries.ts"
import { Shell } from "../shell.tsx"

export const Route = createRootRouteWithContext<{ readonly queryClient: QueryClient }>()({
  // The sidebar's category tree, started before the first page renders.
  loader: (match) => void match.context.queryClient.prefetchQuery(categoriesQuery),
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
  notFoundComponent: NotFound,
})
