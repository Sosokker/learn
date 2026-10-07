import { Schema } from "effect"
import { CardKind, ConceptSlug, ConceptSpec, LessonKind, LessonLang, LessonSpec } from "./lesson.ts"

// What the API speaks. Ids are UUIDv7 text; times are integer milliseconds.

export const UserId = Schema.String.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type
export const LessonId = Schema.String.pipe(Schema.brand("LessonId"))
export type LessonId = typeof LessonId.Type
export const VersionId = Schema.String.pipe(Schema.brand("VersionId"))
export type VersionId = typeof VersionId.Type
export const CategoryId = Schema.String.pipe(Schema.brand("CategoryId"))
export type CategoryId = typeof CategoryId.Type

// learn.sirin.dev/@handle. Lowercase so `@Sirin` and `@sirin` can't both exist.
export const Handle = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{1,29}$/))
export type Handle = typeof Handle.Type
export const LessonSlug = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,79}$/))
export type LessonSlug = typeof LessonSlug.Type
export const TagSlug = Schema.String.check(
  Schema.isPattern(/^[\p{Ll}\p{Lo}\p{N}][\p{Ll}\p{Lo}\p{Mn}\p{Mc}\p{N}-]{0,39}$/u),
)
export type TagSlug = typeof TagSlug.Type
export const BodyHash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))

export const Visibility = Schema.Literals(["private", "unlisted", "public"])
export type Visibility = typeof Visibility.Type

export const maxTags = 5

export const Author = Schema.Struct({
  handle: Handle,
  name: Schema.String,
  image: Schema.NullOr(Schema.String),
})
export type Author = typeof Author.Type

export const Me = Schema.Struct({
  userId: UserId,
  handle: Handle,
  name: Schema.String,
  email: Schema.String,
  image: Schema.NullOr(Schema.String),
  bio: Schema.NullOr(Schema.String),
})
export type Me = typeof Me.Type

export const UpdateMe = Schema.Struct({
  handle: Schema.optionalKey(Handle),
  bio: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(280)))),
})

export const Category = Schema.Struct({
  id: CategoryId,
  parentId: Schema.NullOr(CategoryId),
  slug: Schema.String,
  nameEn: Schema.String,
  nameTh: Schema.String,
  sort: Schema.Int,
})
export type Category = typeof Category.Type

// The current version of one language of a lesson.
export const LessonBody = Schema.Struct({
  lang: LessonLang,
  versionId: VersionId,
  n: Schema.Int,
  hash: BodyHash,
  bytes: Schema.Int,
  title: Schema.String,
  summary: Schema.String,
  createdAt: Schema.Number,
})
export type LessonBody = typeof LessonBody.Type

export const LessonSummary = Schema.Struct({
  id: LessonId,
  slug: LessonSlug,
  owner: Author,
  kind: LessonKind,
  // Title and summary of the first language (the one it was created in); `bodies` has the rest.
  lang: LessonLang,
  title: Schema.String,
  summary: Schema.String,
  langs: Schema.Array(LessonLang),
  visibility: Visibility,
  categoryId: Schema.NullOr(CategoryId),
  tags: Schema.Array(TagSlug),
  likeCount: Schema.Int,
  forkCount: Schema.Int,
  publishedAt: Schema.NullOr(Schema.Number),
  updatedAt: Schema.Number,
})
export type LessonSummary = typeof LessonSummary.Type

export const LessonDetail = Schema.Struct({
  ...LessonSummary.fields,
  bodies: Schema.Array(LessonBody),
  isOwner: Schema.Boolean,
})
export type LessonDetail = typeof LessonDetail.Type

// Keyset pages: `next` is an opaque cursor, null on the last page.
export const Page = <S extends Schema.Top>(item: S) =>
  Schema.Struct({ items: Schema.Array(item), next: Schema.NullOr(Schema.String) })

export const FeedSort = Schema.Literals(["new", "hot"])
export type FeedSort = typeof FeedSort.Type

export const CreateLesson = Schema.Struct({
  slug: LessonSlug,
  spec: LessonSpec,
  note: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
})
export const AddVersion = Schema.Struct({
  spec: LessonSpec,
  note: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
})
export const UpdateLesson = Schema.Struct({
  slug: Schema.optionalKey(LessonSlug),
  visibility: Schema.optionalKey(Visibility),
  categoryId: Schema.optionalKey(Schema.NullOr(CategoryId)),
  // Free text; the server normalizes it ("Epsilon Delta" → "epsilon-delta") and then checks it.
  tags: Schema.optionalKey(
    Schema.Array(Schema.String.check(Schema.isMaxLength(40))).check(Schema.isMaxLength(maxTags)),
  ),
})

// ── Shared concepts
export const ConceptSummary = Schema.Struct({
  slug: ConceptSlug,
  kind: CardKind,
  lang: LessonLang,
  title: Schema.String,
  aliases: Schema.Array(Schema.String),
  version: Schema.Int,
  langs: Schema.Array(LessonLang),
  useCount: Schema.Int,
})
export type ConceptSummary = typeof ConceptSummary.Type

// One concept version as a lesson sees it: the spec plus where it came from.
export const PinnedConcept = Schema.Struct({
  slug: ConceptSlug,
  version: Schema.Int,
  useCount: Schema.Int,
  spec: ConceptSpec,
})
export type PinnedConcept = typeof PinnedConcept.Type

export const ConceptDetail = Schema.Struct({
  slug: ConceptSlug,
  useCount: Schema.Int,
  langs: Schema.Array(PinnedConcept),
})
export type ConceptDetail = typeof ConceptDetail.Type

// Concepts a lesson version uses, pinned at publish, plus their prerequisites (transitively), so
// the reader can drill down without more requests.
export const ConceptBundle = Schema.Struct({ concepts: Schema.Array(PinnedConcept) })
export type ConceptBundle = typeof ConceptBundle.Type

// ── API tokens for pi `/publish`. The token is shown once; only its hash is stored.
export const ApiTokenInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  createdAt: Schema.Number,
  lastUsedAt: Schema.NullOr(Schema.Number),
})
export const CreatedApiToken = Schema.Struct({ ...ApiTokenInfo.fields, token: Schema.String })

// ── Errors. Status codes live on the error so HttpApi and the client agree.
export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  { message: Schema.String },
  {
    httpApiStatus: 404,
  },
) {}
export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}
export class Forbidden extends Schema.TaggedError<Forbidden>()(
  "Forbidden",
  { message: Schema.String },
  {
    httpApiStatus: 403,
  },
) {}
export class Conflict extends Schema.TaggedError<Conflict>()(
  "Conflict",
  { message: Schema.String },
  {
    httpApiStatus: 409,
  },
) {}
// A lesson or concept that decoded but breaks a rule: a broken reference, a translation that
// doesn't match, or "public needs a category".
export class Invalid extends Schema.TaggedError<Invalid>()(
  "Invalid",
  {
    message: Schema.String,
    issues: Schema.Array(Schema.Struct({ path: Schema.String, message: Schema.String })),
  },
  { httpApiStatus: 422 },
) {}
