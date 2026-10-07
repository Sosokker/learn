import {
  type FeedSort,
  type LessonBody,
  type LessonDetail,
  type LessonKind,
  type LessonLang,
  LessonSpec,
  type Me,
  type VersionId,
} from "@app/domain"
import { infiniteQueryOptions, QueryClient, queryOptions } from "@tanstack/react-query"
import { Schema } from "effect"
import { ApiError, call, fetchJson, toApiError } from "./api.ts"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry only what can get better by itself: the network and 5xx.
      retry: (count, error) => {
        const kind = toApiError(error).kind
        return count < 2 && (kind === "Network" || kind === "Server")
      },
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

// Anonymous visitors get 401: that is "signed out", not an error.
export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: async ({ signal }): Promise<Me | null> => {
    try {
      return await call((c) => c.me.get(), signal)
    } catch (e) {
      if (e instanceof ApiError && e.kind === "Unauthorized") return null
      throw e
    }
  },
  staleTime: 5 * 60_000,
})

export const categoriesQuery = queryOptions({
  queryKey: ["categories"],
  queryFn: ({ signal }) => call((c) => c.system.categories(), signal),
  // A curated tree that changes with deploys, not with use.
  staleTime: 60 * 60_000,
})

export interface FeedFilters {
  readonly sort: FeedSort
  readonly kind?: LessonKind | undefined
  readonly lang?: LessonLang | undefined
  readonly categories?: string | undefined
  readonly tag?: string | undefined
  readonly q?: string | undefined
}

export const feedQuery = (filters: FeedFilters) =>
  infiniteQueryOptions({
    queryKey: ["feed", filters],
    queryFn: ({ pageParam, signal }) =>
      call(
        (c) =>
          c.lessons.feed({
            query: {
              sort: filters.sort,
              kind: filters.kind,
              lang: filters.lang,
              categories: filters.categories,
              tag: filters.tag,
              q: filters.q,
              cursor: pageParam,
            },
          }),
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next ?? undefined,
  })

export const libraryQuery = infiniteQueryOptions({
  queryKey: ["library"],
  queryFn: ({ pageParam, signal }) =>
    call((c) => c.lessons.library({ query: { cursor: pageParam } }), signal),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (page) => page.next ?? undefined,
})

export const lessonQuery = (handle: string, slug: string) =>
  queryOptions({
    queryKey: ["lesson", handle, slug],
    queryFn: ({ signal }) => call((c) => c.lessons.byHandle({ params: { handle, slug } }), signal),
  })

// The body in the UI language when the lesson has it, else the first one.
export function pickBody(detail: LessonDetail, wanted: LessonLang): LessonBody | undefined {
  return detail.bodies.find((b) => b.lang === wanted) ?? detail.bodies[0]
}

const decodeSpec = Schema.decodeUnknownSync(LessonSpec)

// Public and unlisted bodies come from /c/<hash>.json (immutable, edge-cached). Private ones are
// served only to the owner, through the API.
export const bodyQuery = (detail: LessonDetail, body: LessonBody) =>
  queryOptions({
    queryKey: ["body", body.hash, detail.visibility === "private" ? detail.id : "public"],
    queryFn: async ({ signal }): Promise<LessonSpec> => {
      if (detail.visibility === "private") {
        return call((c) => c.lessons.body({ params: { id: detail.id, lang: body.lang } }), signal)
      }
      const json = await fetchJson(`/c/${body.hash}.json`, signal)
      try {
        return decodeSpec(json)
      } catch (e) {
        throw new ApiError("BadResponse", e instanceof Error ? e.message : String(e))
      }
    },
    // Content-addressed: a hash never changes.
    staleTime: Number.POSITIVE_INFINITY,
  })

export const conceptsQuery = (versionId: VersionId) =>
  queryOptions({
    queryKey: ["concepts", versionId],
    queryFn: ({ signal }) => call((c) => c.lessons.concepts({ params: { versionId } }), signal),
    staleTime: Number.POSITIVE_INFINITY,
  })

export const tagsQuery = (prefix: string) =>
  queryOptions({
    queryKey: ["tags", prefix],
    queryFn: ({ signal }) => call((c) => c.lessons.tags({ query: { prefix: prefix || undefined } }), signal),
    staleTime: 5 * 60_000,
  })

export const tokensQuery = queryOptions({
  queryKey: ["tokens"],
  queryFn: ({ signal }) => call((c) => c.me.tokens(), signal),
})
