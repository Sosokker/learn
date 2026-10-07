import type { CategoryId, FeedCursor, Lesson, LessonLangInfo, LessonPage } from "@app/api"
import { decodeLesson, type LessonSpec } from "@app/domain"
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query"
import { type Effect, Result } from "effect"
import { callApi } from "./api.ts"

// Query keys and functions, shared by route loaders (prefetch) and components.

export const categoriesQuery = queryOptions({
  queryKey: ["categories"] as const,
  queryFn: (context) => callApi((client) => client.categories.list(), context.signal),
  // A curated tree that changes with a deploy.
  staleTime: 10 * 60_000,
})

export const meQuery = (userId: string) =>
  queryOptions({
    queryKey: ["me", userId] as const,
    queryFn: (context) => callApi((client) => client.me.get(), context.signal),
  })

// Keyed by the viewer: the same lesson reads differently for its owner (is_owner, private).
export const lessonQuery = (handle: string, slug: string, viewer: string | null) =>
  queryOptions({
    queryKey: ["lesson", handle, slug, viewer] as const,
    queryFn: (context) =>
      callApi((client) => client.lessons.getBySlug({ params: { handle, slug } }), context.signal),
    retry: false,
  })

// The body of one version. Public and unlisted bodies come from the immutable, edge-cached
// `/c/<hash>.json`; a private body only through the owner-checked API.
export const bodyQuery = (lesson: Lesson, info: LessonLangInfo) =>
  queryOptions({
    queryKey: ["body", info.body_hash, lesson.visibility === "private" ? lesson.id : "public"] as const,
    queryFn: async (context): Promise<LessonSpec> => {
      if (lesson.visibility === "private") {
        return callApi(
          (client) => client.lessons.body({ params: { id: lesson.id, versionId: info.version_id } }),
          context.signal,
        )
      }
      const response = await fetch(`/c/${info.body_hash}.json`, { signal: context.signal })
      if (!response.ok) throw new Error(`body ${info.body_hash}: HTTP ${response.status}`)
      const decoded = decodeLesson(await response.json())
      if (Result.isFailure(decoded)) throw new Error(decoded.failure.message)
      return decoded.success
    },
    // Bodies never change for a hash.
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  })

export const conceptBundleQuery = (lesson: Lesson, info: LessonLangInfo) =>
  queryOptions({
    queryKey: ["concepts", lesson.id, info.version_id] as const,
    queryFn: (context) =>
      callApi(
        (client) => client.lessons.concepts({ params: { id: lesson.id, versionId: info.version_id } }),
        context.signal,
      ),
    // Pinned at publish: a version's bundle never changes.
    staleTime: Number.POSITIVE_INFINITY,
  })

export type Feed =
  | { readonly kind: "new" }
  | { readonly kind: "category"; readonly id: CategoryId }
  | { readonly kind: "tag"; readonly slug: string }

const feedKey = (feed: Feed) =>
  feed.kind === "new"
    ? ["feed", "new"]
    : feed.kind === "category"
      ? ["feed", "category", feed.id]
      : ["feed", "tag", feed.slug]

export const feedQuery = (feed: Feed, limit?: number) =>
  infiniteQueryOptions({
    queryKey: [...feedKey(feed), limit ?? 0] as const,
    queryFn: (context) => {
      const query = {
        ...(context.pageParam === null ? {} : { cursor: context.pageParam }),
        ...(limit === undefined ? {} : { limit }),
      }
      return callApi((client): Effect.Effect<LessonPage, unknown> => {
        switch (feed.kind) {
          case "new":
            return client.feeds.new({ query })
          case "category":
            return client.feeds.category({ params: { id: feed.id }, query })
          case "tag":
            return client.feeds.tag({ params: { slug: feed.slug }, query })
        }
      }, context.signal)
    },
    initialPageParam: null as FeedCursor | null,
    getNextPageParam: (last: LessonPage) => last.next_cursor,
    retry: false,
  })

export const myLessonsKey = ["mine"] as const

export const myLessonsQuery = (userId: string) =>
  infiniteQueryOptions({
    queryKey: [...myLessonsKey, userId] as const,
    queryFn: (context) =>
      callApi(
        (client) =>
          client.lessons.mine({ query: context.pageParam === null ? {} : { cursor: context.pageParam } }),
        context.signal,
      ),
    initialPageParam: null as FeedCursor | null,
    getNextPageParam: (last: LessonPage) => last.next_cursor,
  })

// The platform guide ("Start here"), published by seed:local as @learn/start-here.
export const guideRef = { handle: "learn", slug: "start-here" } as const
