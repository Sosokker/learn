import {
  concept,
  conceptLang,
  conceptNeed,
  conceptVersion,
  Db,
  lessonVersionConcept,
  sha256Hex,
  uuidv7,
} from "@app/db"
import {
  type ConceptDetail,
  type ConceptSlug,
  ConceptSpec,
  type ConceptSummary,
  Forbidden,
  Invalid,
  type Issue,
  type LessonLang,
  type PinnedConcept,
  utf8Length,
  type VersionId,
  validateConcept,
} from "@app/domain"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { Content, CurrentUser } from "./context.ts"
import { ftsQuery, searchText } from "./search.ts"

const decodeConcept = Schema.decodeUnknownSync(ConceptSpec)
const maxConceptBytes = 32 * 1024

export interface ConceptPin {
  readonly cardId: string | null
  readonly slug: string
  readonly conceptId: string
  readonly versionId: string
}

export interface ResolvedConcepts {
  // The concepts the lesson's cards point at.
  readonly direct: ReadonlyArray<ConceptPin>
  // Their prerequisites, transitively, in the same language (pinned so drill-down never changes).
  readonly needed: ReadonlyArray<ConceptPin>
  readonly issues: ReadonlyArray<Issue>
}

export class Concepts extends Context.Service<
  Concepts,
  {
    readonly resolve: (
      lang: LessonLang,
      refs: ReadonlyArray<{ cardId: string; slug: string; version: number | undefined }>,
    ) => Effect.Effect<ResolvedConcepts>
    readonly bundle: (versionId: VersionId) => Effect.Effect<Array<PinnedConcept>>
    readonly search: (
      q: string | undefined,
      lang: LessonLang | undefined,
    ) => Effect.Effect<Array<ConceptSummary>>
    readonly get: (slug: ConceptSlug) => Effect.Effect<ConceptDetail | null>
    readonly publish: (spec: ConceptSpec) => Effect.Effect<ConceptDetail, Forbidden | Invalid, CurrentUser>
  }
>()("learn/services/Concepts") {
  static readonly layer = Layer.effect(
    Concepts,
    Effect.gen(function* () {
      const { drizzle: db, run } = yield* Db
      const content = yield* Content

      const loadBody = Effect.fnUntraced(function* (hash: string) {
        const text = yield* content.get(hash)
        if (text === null) return yield* Effect.die(new Error(`concept body ${hash} missing from R2`))
        return decodeConcept(JSON.parse(text))
      })

      const resolve = Effect.fn("Concepts.resolve")(function* (
        lang: LessonLang,
        refs: ReadonlyArray<{ cardId: string; slug: string; version: number | undefined }>,
      ) {
        const issues: Array<Issue> = []
        if (refs.length === 0) return { direct: [], needed: [], issues }
        const slugs = [...new Set(refs.map((r) => r.slug))]
        const rows = yield* run(() =>
          db
            .select({ id: concept.id, slug: concept.slug, versionId: conceptLang.versionId })
            .from(concept)
            .leftJoin(conceptLang, and(eq(conceptLang.conceptId, concept.id), eq(conceptLang.lang, lang)))
            .where(inArray(concept.slug, slugs)),
        )
        const bySlug = new Map(rows.map((r) => [r.slug, r]))
        const direct: Array<ConceptPin> = []
        for (const ref of refs) {
          const row = bySlug.get(ref.slug)
          const path = `cards.${ref.cardId}`
          if (row === undefined) {
            issues.push({ path, message: `unknown concept "${ref.slug}"` })
            continue
          }
          if (ref.version === undefined) {
            if (row.versionId === null)
              issues.push({ path, message: `concept "${ref.slug}" has no ${lang} version` })
            else
              direct.push({ cardId: ref.cardId, slug: ref.slug, conceptId: row.id, versionId: row.versionId })
            continue
          }
          const pinned = ref.version
          const [v] = yield* run(() =>
            db
              .select({ id: conceptVersion.id })
              .from(conceptVersion)
              .where(
                and(
                  eq(conceptVersion.conceptId, row.id),
                  eq(conceptVersion.lang, lang),
                  eq(conceptVersion.n, pinned),
                ),
              ),
          )
          if (v === undefined)
            issues.push({ path, message: `concept "${ref.slug}" has no ${lang} version ${pinned}` })
          else direct.push({ cardId: ref.cardId, slug: ref.slug, conceptId: row.id, versionId: v.id })
        }

        // Prerequisites, breadth first over the current graph. A prerequisite without a version in
        // this language is left out: the reader shows what exists.
        const seen = new Set(direct.map((d) => d.conceptId))
        const needed: Array<ConceptPin> = []
        let frontier = [...seen]
        for (let depth = 0; frontier.length > 0 && depth < 8; depth++) {
          const next = yield* run(() =>
            db
              .select({ id: concept.id, slug: concept.slug, versionId: conceptLang.versionId })
              .from(conceptNeed)
              .innerJoin(concept, eq(concept.id, conceptNeed.needId))
              .innerJoin(conceptLang, and(eq(conceptLang.conceptId, concept.id), eq(conceptLang.lang, lang)))
              .where(inArray(conceptNeed.conceptId, frontier)),
          )
          frontier = []
          for (const n of next) {
            if (seen.has(n.id)) continue
            seen.add(n.id)
            frontier.push(n.id)
            needed.push({ cardId: null, slug: n.slug, conceptId: n.id, versionId: n.versionId })
          }
        }
        return { direct, needed, issues }
      })

      const bundle = Effect.fn("Concepts.bundle")(function* (versionId: VersionId) {
        const rows = yield* run(() =>
          db
            .select({
              slug: concept.slug,
              useCount: concept.useCount,
              n: conceptVersion.n,
              hash: conceptVersion.bodyHash,
            })
            .from(lessonVersionConcept)
            .innerJoin(conceptVersion, eq(conceptVersion.id, lessonVersionConcept.conceptVersionId))
            .innerJoin(concept, eq(concept.id, conceptVersion.conceptId))
            .where(eq(lessonVersionConcept.lessonVersionId, versionId)),
        )
        return yield* Effect.forEach(
          rows,
          (r) =>
            Effect.map(
              loadBody(r.hash),
              (spec): PinnedConcept => ({
                slug: r.slug as ConceptSlug,
                version: r.n,
                useCount: r.useCount,
                spec,
              }),
            ),
          { concurrency: 8 },
        )
      })

      const search = Effect.fn("Concepts.search")(function* (
        q: string | undefined,
        lang: LessonLang | undefined,
      ) {
        const match = q === undefined ? null : ftsQuery(q)
        if (q !== undefined && q.trim() !== "" && match === null) return []
        const ids =
          match === null
            ? undefined
            : (yield* run(() =>
                db.all<{ concept_id: string }>(
                  sql`select distinct concept_id from concept_fts where concept_fts match ${match} order by rank limit 40`,
                ),
              )).map((r) => r.concept_id)
        if (ids !== undefined && ids.length === 0) return []
        const rows = yield* run(() =>
          db
            .select({
              id: concept.id,
              slug: concept.slug,
              kind: concept.kind,
              useCount: concept.useCount,
              lang: conceptLang.lang,
              title: conceptLang.title,
              aliases: conceptLang.aliases,
              n: conceptVersion.n,
            })
            .from(concept)
            .innerJoin(conceptLang, eq(conceptLang.conceptId, concept.id))
            .innerJoin(conceptVersion, eq(conceptVersion.id, conceptLang.versionId))
            .where(ids === undefined ? undefined : inArray(concept.id, ids))
            .orderBy(desc(concept.useCount), concept.slug)
            .limit(200),
        )
        // One row per concept, in the asked language when it exists.
        const out = new Map<string, ConceptSummary>()
        for (const r of rows) {
          const prev = out.get(r.id)
          const langs = [...(prev?.langs ?? []), r.lang]
          const better = prev === undefined || (r.lang === lang && prev.lang !== lang)
          const base: ConceptSummary = better
            ? {
                slug: r.slug as ConceptSlug,
                kind: r.kind as ConceptSummary["kind"],
                lang: r.lang,
                title: r.title,
                aliases: JSON.parse(r.aliases) as Array<string>,
                version: r.n,
                langs: [],
                useCount: r.useCount,
              }
            : prev
          out.set(r.id, { ...base, langs })
        }
        const list = [...out.values()]
        if (ids !== undefined)
          list.sort((a, b) => ids.indexOf(slugId(rows, a.slug)) - ids.indexOf(slugId(rows, b.slug)))
        return list.slice(0, 20)
      })

      const get = Effect.fn("Concepts.get")(function* (slug: ConceptSlug) {
        const rows = yield* run(() =>
          db
            .select({ useCount: concept.useCount, n: conceptVersion.n, hash: conceptVersion.bodyHash })
            .from(concept)
            .innerJoin(conceptLang, eq(conceptLang.conceptId, concept.id))
            .innerJoin(conceptVersion, eq(conceptVersion.id, conceptLang.versionId))
            .where(eq(concept.slug, slug)),
        )
        if (rows.length === 0) return null
        const langs = yield* Effect.forEach(rows, (r) =>
          Effect.map(
            loadBody(r.hash),
            (spec): PinnedConcept => ({ slug, version: r.n, useCount: r.useCount, spec }),
          ),
        )
        return { slug, useCount: rows[0]?.useCount ?? 0, langs }
      })

      const publish = Effect.fn("Concepts.publish")(function* (spec: ConceptSpec) {
        const user = yield* CurrentUser
        const body = JSON.stringify(spec)
        const bytes = utf8Length(body)
        if (bytes > maxConceptBytes)
          return yield* new Invalid({
            message: `concept is ${bytes} bytes, the limit is ${maxConceptBytes}`,
            issues: [],
          })

        const needs = yield* run(() =>
          spec.needs.length === 0
            ? Promise.resolve([])
            : db
                .select({ id: concept.id, slug: concept.slug })
                .from(concept)
                .where(inArray(concept.slug, [...spec.needs])),
        )
        const issues = validateConcept(spec, new Set(needs.map((n) => n.slug)))
        const [existing] = yield* run(() => db.select().from(concept).where(eq(concept.slug, spec.slug)))
        if (existing !== undefined) {
          if (existing.createdBy !== user.userId)
            return yield* new Forbidden({ message: "only the author of a concept can change it" })
          if (existing.kind !== spec.card.kind)
            issues.push({
              path: "card.kind",
              message: `this concept is a ${existing.kind}, not ${spec.card.kind}`,
            })
          // New needs must not lead back to this concept.
          let frontier = needs.map((n) => n.id)
          const seen = new Set(frontier)
          for (let depth = 0; frontier.length > 0 && depth < 16; depth++) {
            if (frontier.includes(existing.id)) {
              issues.push({ path: "needs", message: "these needs would make a cycle" })
              break
            }
            const next = yield* run(() =>
              db
                .select({ id: conceptNeed.needId })
                .from(conceptNeed)
                .where(inArray(conceptNeed.conceptId, frontier)),
            )
            frontier = next.map((n) => n.id).filter((id) => !seen.has(id))
            for (const id of frontier) seen.add(id)
          }
        }
        if (issues.length > 0) return yield* new Invalid({ message: "the concept is not valid", issues })

        const hash = yield* Effect.promise(() => sha256Hex(body))
        yield* content.put(hash, body)
        const now = yield* Clock.currentTimeMillis
        const conceptId = existing?.id ?? uuidv7(now)
        const versionId = uuidv7(now)
        const [last] = yield* run(() =>
          db
            .select({ n: sql<number>`max(${conceptVersion.n})` })
            .from(conceptVersion)
            .where(and(eq(conceptVersion.conceptId, conceptId), eq(conceptVersion.lang, spec.lang))),
        )
        const n = (last?.n ?? 0) + 1
        const text = [spec.card.body, spec.card.says, spec.card.useWhen]
          .filter((x) => x !== undefined)
          .join(" ")
        yield* run(() =>
          db.batch([
            existing === undefined
              ? db.insert(concept).values({
                  id: conceptId,
                  slug: spec.slug,
                  kind: spec.card.kind,
                  createdBy: user.userId,
                  createdAt: now,
                  updatedAt: now,
                })
              : db.update(concept).set({ updatedAt: now }).where(eq(concept.id, conceptId)),
            db.insert(conceptVersion).values({
              id: versionId,
              conceptId,
              lang: spec.lang,
              n,
              bodyHash: hash,
              bodyBytes: bytes,
              createdAt: now,
            }),
            db
              .insert(conceptLang)
              .values({
                conceptId,
                lang: spec.lang,
                versionId,
                title: spec.card.title,
                aliases: JSON.stringify(spec.aliases),
              })
              .onConflictDoUpdate({
                target: [conceptLang.conceptId, conceptLang.lang],
                set: { versionId, title: spec.card.title, aliases: JSON.stringify(spec.aliases) },
              }),
            db.delete(conceptNeed).where(eq(conceptNeed.conceptId, conceptId)),
            ...needs.map((need) => db.insert(conceptNeed).values({ conceptId, needId: need.id })),
            db.run(sql`delete from concept_fts where concept_id = ${conceptId} and lang = ${spec.lang}`),
            db.run(sql`insert into concept_fts (concept_id, lang, slug, title, aliases, body)
              values (${conceptId}, ${spec.lang}, ${spec.slug.replace(/[.-]/g, " ")}, ${searchText(spec.card.title)},
                      ${searchText(spec.aliases.join(" "))}, ${searchText(text)})`),
          ]),
        )
        const detail = yield* get(spec.slug)
        return detail ?? (yield* Effect.die(new Error("concept vanished after publish")))
      })

      return Concepts.of({ resolve, bundle, search, get, publish })
    }),
  )
}

function slugId(rows: ReadonlyArray<{ id: string; slug: string }>, slug: string): string {
  return rows.find((r) => r.slug === slug)?.id ?? ""
}
