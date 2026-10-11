import type {
  CategoryId,
  CommentAnchor,
  CommentPage,
  FeedCursor,
  FeedSort,
  Lesson,
  LessonId,
  LessonLangInfo,
  LessonPage,
  ProgressPage,
  ReportPage,
} from "@app/api"
import { decodeLesson, type LessonKind, type LessonLang, type LessonSpec } from "@app/domain"
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query"
import { Effect, Result } from "effect"
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

// One feed of the API. Each is one index range on the server, so only these combinations exist:
// newest by kind or by language, hot by kind, a category (newest), a tag (newest or hot).
export type Feed =
  | {
      readonly kind: "new"
      readonly lessonKind?: LessonKind | undefined
      readonly lang?: LessonLang | undefined
    }
  | { readonly kind: "hot"; readonly lessonKind?: LessonKind | undefined }
  | { readonly kind: "category"; readonly id: CategoryId }
  | { readonly kind: "tag"; readonly slug: string; readonly sort: FeedSort }

const feedKey = (feed: Feed) => {
  switch (feed.kind) {
    case "new":
      return ["feed", "new", feed.lessonKind ?? "", feed.lang ?? ""]
    case "hot":
      return ["feed", "hot", feed.lessonKind ?? ""]
    case "category":
      return ["feed", "category", feed.id]
    case "tag":
      return ["feed", "tag", feed.slug, feed.sort]
  }
}

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
            return client.feeds.new({
              query: {
                ...query,
                ...(feed.lessonKind === undefined ? {} : { kind: feed.lessonKind }),
                ...(feed.lang === undefined ? {} : { lang: feed.lang }),
              },
            })
          case "hot":
            return client.feeds.hot({
              query: { ...query, ...(feed.lessonKind === undefined ? {} : { kind: feed.lessonKind }) },
            })
          case "category":
            return client.feeds.category({ params: { id: feed.id }, query })
          case "tag":
            return client.feeds.tag({ params: { slug: feed.slug }, query: { ...query, sort: feed.sort } })
        }
      }, context.signal)
    },
    initialPageParam: null as FeedCursor | null,
    getNextPageParam: (last: LessonPage) => last.next_cursor,
    retry: false,
  })

// Lesson search: the best matches, one page (the API has no further pages), shaped as a feed so
// the same list renders it.
export const lessonSearchQuery = (q: string, lang: LessonLang | undefined) =>
  infiniteQueryOptions({
    queryKey: ["lesson-search", q, lang ?? ""] as const,
    queryFn: (context): Promise<LessonPage> =>
      callApi(
        (client) =>
          client.lessons
            .search({ query: lang === undefined ? { q } : { q, lang } })
            .pipe(Effect.map((hits): LessonPage => ({ items: hits.items, next_cursor: null }))),
        context.signal,
      ),
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

export const bookmarksKey = ["bookmarks"] as const

export const bookmarksQuery = (userId: string) =>
  infiniteQueryOptions({
    queryKey: [...bookmarksKey, userId] as const,
    queryFn: (context) =>
      callApi(
        (client) =>
          client.engagement.bookmarks({
            query: context.pageParam === null ? {} : { cursor: context.pageParam },
          }),
        context.signal,
      ),
    initialPageParam: null as FeedCursor | null,
    getNextPageParam: (last: LessonPage) => last.next_cursor,
  })

export const progressKey = ["progress"] as const

// "Continue learning": unfinished lessons, most recently read first.
export const progressQuery = (userId: string, limit?: number) =>
  infiniteQueryOptions({
    queryKey: [...progressKey, userId, limit ?? 0] as const,
    queryFn: (context) =>
      callApi(
        (client) =>
          client.engagement.progress({
            query: {
              ...(context.pageParam === null ? {} : { cursor: context.pageParam }),
              ...(limit === undefined ? {} : { limit }),
            },
          }),
        context.signal,
      ),
    initialPageParam: null as FeedCursor | null,
    getNextPageParam: (last: ProgressPage) => last.next_cursor,
  })

// The platform guide ("Start here"), published by seed:local as @learn/start-here.
export const guideRef = { handle: "learn", slug: "start-here" } as const

// Comments of one lesson (all anchors, or one), newest thread first. Keyed by the viewer: hidden
// comments read differently for their author, the lesson's owner and admins.
export const commentsKey = (lessonId: string) => ["comments", lessonId] as const

export const commentsQuery = (lessonId: LessonId, anchor: CommentAnchor | undefined, viewer: string | null) =>
  infiniteQueryOptions({
    queryKey: [...commentsKey(lessonId), anchor ?? "", viewer] as const,
    queryFn: (context) =>
      callApi(
        (client) =>
          client.comments.list({
            params: { id: lessonId },
            query: {
              ...(context.pageParam === null ? {} : { cursor: context.pageParam }),
              ...(anchor === undefined ? {} : { anchor }),
            },
          }),
        context.signal,
      ),
    initialPageParam: null as FeedCursor | null,
    getNextPageParam: (last: CommentPage) => last.next_cursor,
    retry: false,
  })

export const adminReportsKey = ["admin-reports"] as const

export const adminReportsQuery = infiniteQueryOptions({
  queryKey: adminReportsKey,
  queryFn: (context) =>
    callApi(
      (client) =>
        client.admin.reports({ query: context.pageParam === null ? {} : { cursor: context.pageParam } }),
      context.signal,
    ),
  initialPageParam: null as FeedCursor | null,
  getNextPageParam: (last: ReportPage) => last.next_cursor,
  retry: false,
})
