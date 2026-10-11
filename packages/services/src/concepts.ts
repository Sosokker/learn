import {
  BodyHash,
  type Concept,
  ConceptForbidden,
  type ConceptHit,
  ConceptNotFound,
  type ConceptPublished,
  type ConceptUnchanged,
  ConceptVersionId,
  CurrentUser,
  Handle,
  InvalidConcept,
  type Issue,
  PayloadTooLarge,
  platformPrefix,
  platformUserId,
} from "@app/api"
import { Database, raw, uuidv7 } from "@app/db"
import {
  type Card,
  ConceptSlug,
  compareConceptTranslations,
  decodeConcept,
  LessonLang,
  richPlainText,
  validateConcept,
} from "@app/domain"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Result, Schema } from "effect"
import { canonicalJson, contentKey, sha256Hex } from "./content.ts"
import { inList } from "./rows.ts"
import { ftsQuery, searchText } from "./search.ts"
import { Storage } from "./storage.ts"

// A concept is one card (plus prerequisites and aliases); 64 KB is generous.
export const maxConceptBytes = 64 * 1024

export class Concepts extends Context.Service<
  Concepts,
  {
    // Full-text search; Thai is split into words on both sides (see search.ts).
    readonly search: (options: {
      readonly q: string
      readonly lang?: LessonLang | undefined
      readonly limit?: number | undefined
    }) => Effect.Effect<ReadonlyArray<ConceptHit>>
    readonly get: (slug: string) => Effect.Effect<Concept, ConceptNotFound>
    // Creates the concept, or adds the next version of the body's language. Only the creator may
    // add versions: a concept is shared by every lesson that pins it. A body identical to the
    // language's current version writes nothing and returns it (`created: false`).
    readonly publish: (
      body: Uint8Array,
    ) => Effect.Effect<
      ConceptPublished | ConceptUnchanged,
      InvalidConcept | ConceptForbidden | PayloadTooLarge,
      CurrentUser
    >
  }
>()("@app/services/Concepts") {
  static readonly layer = Layer.effect(
    Concepts,
    Effect.gen(function* () {
      const db = yield* Database
      const storage = yield* Storage

      const search = Effect.fn("Concepts.search")(function* (options: {
        readonly q: string
        readonly lang?: LessonLang | undefined
        readonly limit?: number | undefined
      }) {
        const match = ftsQuery(options.q)
        if (match === undefined) return []
        const rows = yield* db
          .query(
            raw(sql`select c.slug, cl.lang, cv.n, cv.body_hash, cl.kind, cl.title, cl.aliases
              from concept_fts f
              join concept c on c.id = f.concept_id
              join concept_lang cl on cl.concept_id = f.concept_id and cl.lang = f.lang
              join concept_version cv on cv.id = cl.version_id
              where concept_fts match ${match} ${options.lang === undefined ? sql`` : sql`and f.lang = ${options.lang}`}
              order by f.rank limit ${options.limit ?? 20}`),
            HitRow,
          )
          .pipe(Effect.orDie)
        return rows
      })

      const get = Effect.fn("Concepts.get")(function* (slug: string) {
        const found = yield* db
          .query(
            raw(sql`select c.id, c.slug, p.handle as owner_handle from concept c
              join profile p on p.user_id = c.owner_id where c.slug = ${slug}`),
            ConceptRow,
          )
          .pipe(Effect.orDie)
        const row = found[0]
        if (row === undefined) return yield* new ConceptNotFound({ slug })
        const { langs, needs } = yield* Effect.all(
          {
            langs: db.query(
              raw(sql`select cl.lang, cl.version_id, cv.n, cv.body_hash, cl.kind, cl.title, cl.aliases
                from concept_lang cl join concept_version cv on cv.id = cl.version_id
                where cl.concept_id = ${row.id} order by cl.lang`),
              LangRow,
            ),
            needs: db.query(
              raw(sql`select c.slug from concept_need n join concept c on c.id = n.need_id
                where n.concept_id = ${row.id} order by c.slug`),
              SlugRow,
            ),
          },
          { concurrency: "unbounded" },
        ).pipe(Effect.orDie)
        const concept: Concept = {
          slug: row.slug,
          owner_handle: row.owner_handle,
          needs: needs.map((need) => need.slug),
          langs,
        }
        return concept
      })

      const publish = Effect.fn("Concepts.publish")(function* (body: Uint8Array) {
        const user = yield* CurrentUser
        if (body.byteLength > maxConceptBytes)
          return yield* new PayloadTooLarge({ max_bytes: maxConceptBytes })
        const json = yield* Effect.try({
          try: (): unknown =>
            JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body)),
          catch: (cause) =>
            new InvalidConcept({
              issues: [{ path: "$", code: "json", message: `not JSON: ${String(cause)}` }],
            }),
        })
        const decoded = decodeConcept(json)
        if (Result.isFailure(decoded)) {
          return yield* new InvalidConcept({
            issues: [{ path: "$", code: "schema", message: decoded.failure.message }],
          })
        }
        const spec = decoded.success
        // `platform.*` names are the platform's own (they look official). Every other slug the
        // platform user owns is protected by the owner check below, like anyone's.
        if (spec.slug.startsWith(`${platformPrefix}.`) && user.id !== platformUserId) {
          return yield* new ConceptForbidden({
            message: `concept names under ${platformPrefix}. are reserved`,
          })
        }
        const issues: Array<Issue> = [...validateConcept(spec)]

        const existing = yield* db
          .query(raw(sql`select id, owner_id from concept where slug = ${spec.slug}`), OwnerRow)
          .pipe(
            Effect.orDie,
            Effect.map((rows) => Option.fromNullishOr(rows[0])),
          )
        if (Option.isSome(existing) && existing.value.owner_id !== user.id) {
          return yield* new ConceptForbidden({ message: `concept ${spec.slug} belongs to another user` })
        }

        // Prerequisites must exist, and the graph must stay acyclic: a need may not (transitively)
        // need this concept.
        const needs =
          spec.needs.length === 0
            ? []
            : yield* db
                .query(raw(sql`select id, slug from concept where slug in ${inList(spec.needs)}`), NeedRow)
                .pipe(Effect.orDie)
        spec.needs.forEach((slug, index) => {
          if (!needs.some((need) => need.slug === slug)) {
            issues.push({
              path: `needs[${index}]`,
              code: "unknown_concept",
              message: `"${slug}" does not exist`,
            })
          }
        })
        if (Option.isSome(existing) && needs.length > 0) {
          const reach = yield* db
            .query(
              raw(sql`with recursive reach(id) as (
                  select id from concept where id in ${inList(needs.map((need) => need.id))}
                  union select n.need_id from concept_need n join reach r on n.concept_id = r.id
                ) select id from reach where id = ${existing.value.id} limit 1`),
              IdRow,
            )
            .pipe(Effect.orDie)
          if (reach.length > 0) {
            issues.push({
              path: "needs",
              code: "cycle",
              message: `the needs of ${spec.slug} lead back to it`,
            })
          }
        }

        // The languages of one concept agree on kind and needs.
        if (Option.isSome(existing)) {
          const others = yield* db
            .query(
              raw(sql`select cv.body_hash from concept_lang cl join concept_version cv on cv.id = cl.version_id
                where cl.concept_id = ${existing.value.id} and cl.lang <> ${spec.lang}`),
              HashRow,
            )
            .pipe(Effect.orDie)
          for (const other of others) {
            const stored = yield* storage.get(contentKey(other.body_hash)).pipe(Effect.orDie)
            if (Option.isNone(stored))
              return yield* Effect.die(new Error(`body ${other.body_hash} is missing`))
            const otherSpec = yield* Effect.try({
              try: (): unknown => JSON.parse(new TextDecoder().decode(stored.value.body)),
              catch: (cause) => cause,
            }).pipe(
              Effect.flatMap((value) => Effect.fromResult(decodeConcept(value))),
              Effect.orDie,
            )
            issues.push(...compareConceptTranslations(otherSpec, spec))
          }
        }
        if (issues.length > 0) return yield* new InvalidConcept({ issues })

        const canonical = canonicalJson(spec)
        const hash = yield* Effect.promise(() => sha256Hex(canonical))
        // The body holds everything a version is (card, aliases, needs), so the same hash is the
        // same version.
        if (Option.isSome(existing)) {
          const current = yield* db
            .query(
              raw(sql`select cv.id as version_id, cv.n, cv.body_hash from concept_lang cl
                join concept_version cv on cv.id = cl.version_id
                where cl.concept_id = ${existing.value.id} and cl.lang = ${spec.lang}`),
              CurrentRow,
            )
            .pipe(Effect.orDie)
          const same = current[0]
          if (same !== undefined && same.body_hash === hash) {
            const unchanged: ConceptUnchanged = { slug: spec.slug, lang: spec.lang, ...same, created: false }
            return unchanged
          }
        }
        const key = contentKey(hash)
        if (!(yield* storage.exists(key).pipe(Effect.orDie))) {
          yield* storage.put(key, { body: canonical, contentType: "application/json" }).pipe(Effect.orDie)
        }

        // Rows an older Worker left must be in line before this batch takes the next rowid.
        yield* repairConceptFts(db)
        const now = Date.now()
        const conceptId = Option.match(existing, { onNone: () => uuidv7(now), onSome: (row) => row.id })
        const versionId = uuidv7(now)
        const search = searchText(
          [spec.slug.replaceAll(/[.-]/g, " "), ...spec.aliases, ...cardText(spec.card)].join("\n"),
        )
        yield* db
          .batch([
            Option.isNone(existing)
              ? raw(sql`insert into concept (id, slug, owner_id, created_at, updated_at)
                  values (${conceptId}, ${spec.slug}, ${user.id}, ${now}, ${now})`)
              : raw(sql`update concept set updated_at = ${now} where id = ${conceptId}`),
            raw(sql`insert into concept_version (id, concept_id, lang, n, body_hash, body_bytes, created_at)
              select ${versionId}, ${conceptId}, ${spec.lang}, coalesce(max(n), 0) + 1, ${hash}, ${canonical.byteLength}, ${now}
              from concept_version where concept_id = ${conceptId} and lang = ${spec.lang}`),
            // A new row takes the next FTS rowid (nextConceptFtsRowid); an existing row keeps its own.
            raw(sql`insert into concept_lang (concept_id, lang, version_id, kind, title, aliases, search, fts_rowid, updated_at)
              values (${conceptId}, ${spec.lang}, ${versionId}, ${spec.card.kind}, ${richPlainText(spec.card.title)},
                ${JSON.stringify(spec.aliases)}, ${search}, ${nextConceptFtsRowid}, ${now})
              on conflict (concept_id, lang) do update set version_id = excluded.version_id, kind = excluded.kind,
                title = excluded.title, aliases = excluded.aliases, search = excluded.search,
                fts_rowid = coalesce(concept_lang.fts_rowid, excluded.fts_rowid), updated_at = excluded.updated_at`),
            raw(sql`delete from concept_need where concept_id = ${conceptId}`),
            ...needs.map((need) =>
              raw(sql`insert into concept_need (concept_id, need_id) values (${conceptId}, ${need.id})`),
            ),
            // By rowid: concept_fts's concept_id and lang are UNINDEXED, so `where concept_id = ?`
            // would scan the whole FTS table.
            raw(sql`delete from concept_fts where rowid = (select fts_rowid from concept_lang
              where concept_id = ${conceptId} and lang = ${spec.lang})`),
            raw(sql`insert into concept_fts (rowid, concept_id, lang, search)
              select fts_rowid, concept_id, lang, search from concept_lang
              where concept_id = ${conceptId} and lang = ${spec.lang}`),
          ])
          .pipe(Effect.orDie)

        const stored = yield* db
          .query(raw(sql`select n from concept_version where id = ${versionId}`), NRow)
          .pipe(Effect.orDie)
        const published: ConceptPublished = {
          slug: spec.slug,
          lang: spec.lang,
          n: stored[0]?.n ?? 1,
          version_id: ConceptVersionId.make(versionId),
          body_hash: BodyHash.make(hash),
          created: true,
        }
        return published
      })

      return Concepts.of({ search, get, publish })
    }),
  )
}

// The FTS rowid for a new concept_lang row: past both the highest one handed out and the highest
// row in concept_fts (see nextLessonFtsRowid), so a row an older Worker inserted with an automatic
// rowid cannot collide with it. Two single-row reads.
const nextConceptFtsRowid = sql`(select max(
    coalesce((select max(fts_rowid) from concept_lang), 0),
    coalesce((select rowid from concept_fts order by rowid desc limit 1), 0)
  ) + 1)`

// Repairs what a Worker from before migration 0004 leaves when it publishes a concept after the
// migrations ran (the deploy window): a concept_lang row without fts_rowid, and a concept_fts row
// with an automatic rowid (max + 1 at the time) that no concept_lang row points at, which would
// stay as a duplicate hit. Run by the cron and before every concept publish. With nothing to
// repair it costs two index reads: the strays are above the highest fts_rowid (a rowid range of
// concept_fts), and rows without one are a range of the unique fts_rowid index.
export const repairConceptFts = Effect.fn("Concepts.repairFts")(function* (db: Database["Service"]) {
  const strays = yield* db
    .query(
      raw(sql`select rowid as fts_rowid, concept_id, lang from concept_fts
        where rowid > (select coalesce(max(fts_rowid), 0) from concept_lang) order by rowid`),
      StrayRow,
    )
    .pipe(Effect.orDie)
  const missing = yield* db
    .query(raw(sql`select concept_id, lang from concept_lang where fts_rowid is null limit 25`), KeyRow)
    .pipe(Effect.orDie)
  const adopted = (key: typeof KeyRow.Type) =>
    strays.some((stray) => stray.concept_id === key.concept_id && stray.lang === key.lang)
  const unmatched = missing.filter((key) => !adopted(key))
  if (strays.length === 0 && unmatched.length === 0) return
  // Rebuilt from concept_lang.search, which every Worker version writes, so the FTS row has the
  // current text whichever write came last.
  const resync = (key: typeof KeyRow.Type) => [
    raw(sql`delete from concept_fts where rowid = (select fts_rowid from concept_lang
      where concept_id = ${key.concept_id} and lang = ${key.lang})`),
    raw(sql`insert into concept_fts (rowid, concept_id, lang, search)
      select fts_rowid, concept_id, lang, search from concept_lang
      where concept_id = ${key.concept_id} and lang = ${key.lang} and fts_rowid is not null`),
  ]
  yield* db
    .batch([
      // A stray becomes its row's FTS row when the row has none, else it goes.
      ...strays.flatMap((stray) => [
        raw(sql`update concept_lang set fts_rowid = ${stray.fts_rowid}
          where concept_id = ${stray.concept_id} and lang = ${stray.lang} and fts_rowid is null`),
        raw(sql`delete from concept_fts where rowid = ${stray.fts_rowid}`),
        ...resync(stray),
      ]),
      // Rows still without one get the next rowid. The old Worker's FTS row for them is found by
      // its UNINDEXED columns, a scan of concept_fts; only rows from the deploy window get here.
      ...unmatched.flatMap((key) => [
        raw(sql`update concept_lang set fts_rowid = ${nextConceptFtsRowid}
          where concept_id = ${key.concept_id} and lang = ${key.lang} and fts_rowid is null`),
        raw(sql`delete from concept_fts where concept_id = ${key.concept_id} and lang = ${key.lang}`),
        ...resync(key),
      ]),
    ])
    .pipe(Effect.orDie)
})

const StrayRow = Schema.Struct({ fts_rowid: Schema.Int, concept_id: Schema.String, lang: LessonLang })
const KeyRow = Schema.Struct({ concept_id: Schema.String, lang: LessonLang })

const cardText = (card: Card): ReadonlyArray<string> =>
  [card.title, card.body, card.says, card.useWhen, card.example]
    .filter((field) => field !== undefined)
    .map((field) => richPlainText(field))

const Aliases = Schema.fromJsonString(Schema.Array(Schema.String))
const HitRow = Schema.Struct({
  slug: ConceptSlug,
  lang: LessonLang,
  n: Schema.Int,
  body_hash: BodyHash,
  kind: Schema.String,
  title: Schema.String,
  aliases: Aliases,
})
const LangRow = Schema.Struct({
  lang: LessonLang,
  version_id: ConceptVersionId,
  n: Schema.Int,
  body_hash: BodyHash,
  kind: Schema.String,
  title: Schema.String,
  aliases: Aliases,
})
const ConceptRow = Schema.Struct({ id: Schema.String, slug: ConceptSlug, owner_handle: Handle })
const SlugRow = Schema.Struct({ slug: ConceptSlug })
const OwnerRow = Schema.Struct({ id: Schema.String, owner_id: Schema.String })
const NeedRow = Schema.Struct({ id: Schema.String, slug: Schema.String })
const IdRow = Schema.Struct({ id: Schema.String })
const HashRow = Schema.Struct({ body_hash: BodyHash })
const NRow = Schema.Struct({ n: Schema.Int })
const CurrentRow = Schema.Struct({ version_id: ConceptVersionId, n: Schema.Int, body_hash: BodyHash })
