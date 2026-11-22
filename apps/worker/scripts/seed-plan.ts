// The seed's data plan: which D1 statements and R2 objects bring a target (local or remote) up to
// date with content/. It is computed once, the same way for every target:
//
// 1. Copy the target's current seed rows (the @learn user and profile, the content concepts, the
//    guide lesson and their versions, pins and tags) into a scratch, in-memory D1.
// 2. Run the real services (Concepts.publish, Lessons.publish, Lessons.update) against the
//    scratch D1, as @learn. Content is validated, hashed and pinned exactly as in /publish.
// 3. Record every write batch the services make and every object they store.
//
// Applying the plan replays those batches on the target, in order, after uploading the objects.
// Values computed in SQL (version numbers, counters) are recomputed by the target itself. A body
// that is already current is not published again, so an up-to-date target gets an empty plan.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { CurrentUser, LessonId, platformUserId } from "@app/api"
import { type Compilable, D1, Database } from "@app/db"
import { decodeConcept, decodeLesson } from "@app/domain"
import { Concepts, canonicalJson, Lessons, Storage, StorageError, sha256Hex } from "@app/services"
import { Effect, Layer, Option, Result, Schema } from "effect"
import { convertV4MiniflareOptions, Miniflare } from "miniflare"

export const workerDir = join(import.meta.dirname, "..")
const contentDir = join(workerDir, "../../content")
const lessonsDir = join(workerDir, "../../lessons")
const migrationsDir = join(workerDir, "../../packages/db/migrations")

export interface SeedOptions {
  /** Also seed `lessons/<slug>/{en,th}.json` locally as unlisted via `Lessons.publishBundle`. */
  readonly includeLocalLessons?: boolean | undefined
}

export type Row = Readonly<Record<string, unknown>>

// What the planner needs from a target: read-only SQL (literal, no parameters) and object reads.
export interface SeedSource {
  readonly query: (statements: ReadonlyArray<string>) => Promise<ReadonlyArray<ReadonlyArray<Row>>>
  readonly getObject: (key: string) => Promise<Uint8Array | undefined>
}

export interface Statement {
  readonly sql: string
  readonly params: ReadonlyArray<unknown>
}

export interface SeedPlan {
  // Each inner array is one D1 batch from a service, in the order the services ran them.
  readonly batches: ReadonlyArray<ReadonlyArray<Statement>>
  readonly objects: ReadonlyArray<{ readonly key: string; readonly body: Uint8Array }>
}

// The email is in the reserved `.invalid` TLD and unverified, so no Google account can ever match
// it (Better Auth's account linking is off too, and auth.ts refuses sessions and accounts for it).
export const platformUser = {
  id: platformUserId,
  name: "Learn",
  email: "learn@users.invalid",
  image: null,
  viaToken: false,
}
const guideSlug = "start-here"
const guideSettings = {
  visibility: "public",
  category_id: "platform.guide",
  tags: ["guide", "start-here"],
} as const

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(contentDir, path), "utf8"))
const hashOf = (spec: unknown) => sha256Hex(canonicalJson(spec))

const localLessonSlugs = (): ReadonlyArray<string> =>
  readdirSync(lessonsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

// Concepts in prerequisite order, so every `needs` exists when its concept is published.
const conceptSlugs = () => {
  const needs = new Map(
    readdirSync(join(contentDir, "concepts")).map((slug) => {
      const decoded = decodeConcept(readJson(`concepts/${slug}/en.json`))
      if (Result.isFailure(decoded)) throw new Error(`${slug}: ${decoded.failure.message}`)
      return [slug, decoded.success.needs] as const
    }),
  )
  const ordered: Array<string> = []
  const visit = (slug: string, path: ReadonlyArray<string>) => {
    if (ordered.includes(slug)) return
    if (path.includes(slug)) throw new Error(`concept cycle: ${[...path, slug].join(" → ")}`)
    for (const need of needs.get(slug) ?? []) visit(need, [...path, slug])
    ordered.push(slug)
  }
  for (const slug of [...needs.keys()].sort()) visit(slug, [])
  return ordered
}

// A SQL literal for a bound value. Used to copy rows and to write the plan as a .sql file.
export const sqlLiteral = (value: unknown): string => {
  if (value === null || value === undefined) return "null"
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`
  if (typeof value === "boolean") return value ? "1" : "0"
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`cannot write ${value} as SQL`)
    return String(value)
  }
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString("hex")}'`
  throw new Error(`cannot write ${typeof value} as SQL`)
}

// Replaces each `?` placeholder (outside quoted strings and identifiers) with its value.
export const inlineStatement = (statement: Statement): string => {
  let out = ""
  let next = 0
  let quote: string | undefined
  for (const char of statement.sql) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      out += char
    } else if (char === "'" || char === '"' || char === "`") {
      quote = char
      out += char
    } else if (char === "?") {
      if (next >= statement.params.length) throw new Error(`too few parameters for: ${statement.sql}`)
      out += sqlLiteral(statement.params[next])
      next += 1
    } else {
      out += char
    }
  }
  if (next !== statement.params.length) throw new Error(`too many parameters for: ${statement.sql}`)
  return out
}

// The rows the services read while publishing the seed, in foreign-key order.
const snapshotQueries = (slugs: ReadonlyArray<string>, lessonSlugs: ReadonlyArray<string>) => {
  const slugList = slugs.map(sqlLiteral).join(", ")
  const lessonList = lessonSlugs.map(sqlLiteral).join(", ")
  const concepts = `select id from concept where slug in (${slugList})`
  const seededLessons = `select id from lesson where owner_id = ${sqlLiteral(platformUser.id)} and slug in (${lessonList})`
  const users = `id = ${sqlLiteral(platformUser.id)} or id in (select owner_id from concept where slug in (${slugList}))`
  const tagSlugs = guideSettings.tags.map(sqlLiteral).join(", ")
  return [
    ["user", `select * from "user" where ${users}`],
    ["profile", `select * from profile where user_id in (select id from "user" where ${users})`],
    ["concept", `select * from concept where slug in (${slugList})`],
    ["concept_version", `select * from concept_version where concept_id in (${concepts})`],
    ["concept_lang", `select * from concept_lang where concept_id in (${concepts})`],
    ["concept_need", `select * from concept_need where concept_id in (${concepts})`],
    ["lesson", `select * from lesson where id in (${seededLessons})`],
    ["lesson_version", `select * from lesson_version where lesson_id in (${seededLessons})`],
    ["lesson_lang", `select * from lesson_lang where lesson_id in (${seededLessons})`],
    [
      "lesson_version_concept",
      `select * from lesson_version_concept where lesson_version_id in (select id from lesson_version where lesson_id in (${seededLessons}))`,
    ],
    [
      "tag",
      `select * from tag where slug in (${tagSlugs}) or id in (select tag_id from lesson_tag where lesson_id in (${seededLessons}))`,
    ],
    ["lesson_tag", `select * from lesson_tag where lesson_id in (${seededLessons})`],
  ] as const
}

// Applies migrations/*.sql in order, statement by statement, as `wrangler d1 migrations apply`.
const migrate = async (db: D1Database) => {
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
  for (const file of files) {
    const statements = readFileSync(join(migrationsDir, file), "utf8")
      .split("--> statement-breakpoint")
      .map((chunk) =>
        chunk
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter((statement) => statement !== "")
    for (const statement of statements) await db.prepare(statement).run()
  }
}

const compile = (statement: Compilable): Statement => {
  const compiled = statement.toSQL()
  return { sql: compiled.sql, params: compiled.params }
}

// Database over the scratch D1 that records every write batch after it succeeds. The services
// write only through `batch` and `run`; `query` is reads.
const RecordingDatabase = (batches: Array<ReadonlyArray<Statement>>) =>
  Layer.effect(
    Database,
    Effect.gen(function* () {
      const inner = yield* Database
      return Database.of({
        ...inner,
        run: (statement) =>
          inner.run(statement).pipe(Effect.tap(() => Effect.sync(() => batches.push([compile(statement)])))),
        batch: (statements) =>
          inner
            .batch(statements)
            .pipe(Effect.tap(() => Effect.sync(() => batches.push(statements.map(compile))))),
      })
    }),
  ).pipe(Layer.provide(Database.layer))

// Storage that reads through to the target and keeps new objects in memory, to upload later.
const PlanStorage = (source: SeedSource, objects: Map<string, Uint8Array>) => {
  const fromTarget = new Map<string, Promise<Uint8Array | undefined>>()
  const lookup = (key: string) =>
    Effect.tryPromise({
      try: async () => {
        const local = objects.get(key)
        if (local !== undefined) return local
        const cached = fromTarget.get(key) ?? source.getObject(key)
        fromTarget.set(key, cached)
        return await cached
      },
      catch: (cause) => new StorageError({ cause }),
    })
  return Layer.succeed(
    Storage,
    Storage.of({
      put: (key, object) => Effect.sync(() => void objects.set(key, object.body)),
      get: (key) =>
        lookup(key).pipe(
          Effect.map((body) =>
            Option.fromNullishOr(body).pipe(
              Option.map((bytes) => ({ body: bytes, contentType: "application/json" })),
            ),
          ),
        ),
      exists: (key) => lookup(key).pipe(Effect.map((body) => body !== undefined)),
    }),
  )
}

// A parameterised statement for the Database service (the services build theirs with Drizzle).
const statement = (text: string, ...params: ReadonlyArray<unknown>): Compilable => ({
  toSQL: () => ({ sql: text, params }),
})

const CountRow = Schema.Struct({ n: Schema.Int })

const seed = (log: (line: string) => void, localSlugs: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const db = yield* Database
    const now = Date.now()
    const iso = new Date(now).toISOString()
    // The platform account. It never signs in (no Google account), so it is written directly.
    const [users, profiles] = yield* Effect.all([
      db.query(statement(`select count(*) as n from "user" where id = ?`, platformUser.id), CountRow),
      db.query(statement("select count(*) as n from profile where user_id = ?", platformUser.id), CountRow),
    ]).pipe(Effect.orDie)
    if (users[0]?.n === 0 || profiles[0]?.n === 0) {
      yield* db
        .batch([
          statement(
            `insert or ignore into "user" (id, name, email, email_verified, image, created_at, updated_at)
            values (?, ?, ?, 0, null, ?, ?)`,
            platformUser.id,
            platformUser.name,
            platformUser.email,
            iso,
            iso,
          ),
          statement(
            "insert or ignore into profile (user_id, handle, bio, created_at) values (?, 'learn', ?, ?)",
            platformUser.id,
            "Guides and shared concepts from the Learn team.",
            now,
          ),
        ])
        .pipe(Effect.orDie)
      log("user @learn: created")
    } else {
      log("user @learn: up to date")
    }

    const concepts = yield* Concepts
    for (const slug of conceptSlugs()) {
      const current = yield* concepts.get(slug).pipe(Effect.option)
      for (const lang of ["en", "th"] as const) {
        const json = readJson(`concepts/${slug}/${lang}.json`)
        const hash = yield* Effect.promise(() => hashOf(json))
        const same = Option.exists(current, (concept) =>
          concept.langs.some((info) => info.lang === lang && info.body_hash === hash),
        )
        if (same) {
          log(`concept ${slug} (${lang}): up to date`)
          continue
        }
        const published = yield* concepts.publish(new TextEncoder().encode(JSON.stringify(json)))
        log(`concept ${slug} (${lang}): v${published.n}`)
      }
    }

    const lessons = yield* Lessons
    const existing = yield* lessons.asUser.getBySlug("learn", guideSlug).pipe(Effect.option)
    for (const lang of ["en", "th"] as const) {
      const json = readJson(`guide/${lang}.json`)
      const decoded = decodeLesson(json)
      if (Result.isFailure(decoded))
        return yield* Effect.die(new Error(`guide/${lang}.json: ${decoded.failure.message}`))
      const hash = yield* Effect.promise(() => hashOf(decoded.success))
      const same = Option.exists(existing, (lesson) =>
        lesson.langs.some((info) => info.lang === lang && info.body_hash === hash),
      )
      if (same) {
        log(`guide (${lang}): up to date`)
        continue
      }
      const published = yield* lessons.publish(guideSlug, new TextEncoder().encode(JSON.stringify(json)))
      log(`guide (${lang}): v${published.version.n}`)
    }
    const guide = yield* lessons.asUser.getBySlug("learn", guideSlug)
    const settled =
      guide.visibility === guideSettings.visibility &&
      guide.category_id === guideSettings.category_id &&
      [...guide.tags].sort().join(",") === [...guideSettings.tags].sort().join(",")
    if (settled) {
      log(`guide settings: up to date`)
    } else {
      yield* lessons.update(LessonId.make(guide.id), {
        visibility: guideSettings.visibility,
        category_id: guideSettings.category_id,
        tags: [...guideSettings.tags],
      })
      log(`guide settings: public, ${guideSettings.category_id}, tags ${guideSettings.tags.join(", ")}`)
    }
    log(`guide: /@learn/${guideSlug} (lesson ${guide.id})`)

    for (const slug of localSlugs) {
      const specs = (["en", "th"] as const).map((lang) =>
        JSON.parse(readFileSync(join(lessonsDir, slug, `${lang}.json`), "utf8")),
      )
      const body = new TextEncoder().encode(JSON.stringify({ specs }))
      const published = yield* lessons.publishBundle(slug, body)
      if (published.created) {
        log(
          `lesson ${slug}: ${published.versions.map((v) => `${v.version.lang} v${v.version.n}`).join(", ")}`,
        )
      } else {
        log(`lesson ${slug}: up to date`)
      }
      if (published.lesson.visibility === "private") {
        yield* lessons.update(LessonId.make(published.lesson.id), { visibility: "unlisted" })
        log(`lesson ${slug}: unlisted (/@learn/${slug})`)
      }
    }
  }).pipe(Effect.provideService(CurrentUser, platformUser))

// Computes the plan for one target. Reads the target; never writes to it.
export const planSeed = async (
  source: SeedSource,
  log: (line: string) => void,
  options: SeedOptions = {},
): Promise<SeedPlan> => {
  const slugs = conceptSlugs()
  const localSlugs = options.includeLocalLessons === true ? localLessonSlugs() : []
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch: () => new Response(null, { status: 404 }) }",
      compatibilityDate: "2026-09-30",
      d1Databases: ["DB"],
    }),
  )
  try {
    const { DB: scratch } = await mf.getBindings<{ DB: D1Database }>()
    await migrate(scratch)

    const queries = snapshotQueries(slugs, [guideSlug, ...localSlugs])
    const results = await source.query(queries.map(([, query]) => query))
    const copies = queries.flatMap(([table], index) =>
      (results[index] ?? []).map((row) => {
        const columns = Object.keys(row)
        return scratch
          .prepare(
            `insert into "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) values (${columns.map(() => "?").join(", ")})`,
          )
          .bind(...columns.map((column) => row[column] ?? null))
      }),
    )
    if (copies.length > 0) await scratch.batch(copies)
    log(`target has ${copies.length} seed rows`)

    const batches: Array<ReadonlyArray<Statement>> = []
    const objects = new Map<string, Uint8Array>()
    const layer = Layer.mergeAll(Lessons.layer, Concepts.layer).pipe(
      Layer.provideMerge(RecordingDatabase(batches)),
      Layer.provide(Layer.mergeAll(Layer.succeed(D1, scratch), PlanStorage(source, objects))),
    )
    const exit = await Effect.runPromiseExit(seed(log, localSlugs).pipe(Effect.provide(layer)))
    if (exit._tag === "Failure") throw new Error(`seed failed:\n${String(exit.cause)}`)
    return { batches, objects: [...objects].map(([key, body]) => ({ key, body })) }
  } finally {
    await mf.dispose()
  }
}

export const isEmptyPlan = (plan: SeedPlan) => plan.batches.length === 0 && plan.objects.length === 0

export const planSummary = (plan: SeedPlan) =>
  `${plan.batches.flat().length} SQL statements in ${plan.batches.length} batches, ${plan.objects.length} R2 objects`
