# 0011. Publish the lesson, not one language

- Status: accepted
- Date: 2026-10-29
- Supersedes in part: ADR 0010 (the per-language publish endpoint)

## Context

ADR 0010 made the external agent contract file-based: `learn.mjs` validates
`{ "specs": [en, th] }` and then publishes each language with a separate
`POST /api/me/lessons/:slug/versions`. The dry run already treats the lesson as
one unit, but publish did not:

- A new lesson's en/th parity was checked by the dry run. A publish could still
  write the first language and fail on the second if the stored lesson changed
  between the two requests, or if the pair only matched the old stored body.
  The CLI then had to tell the user the lesson was half published.
- The publish rules were re-decided by four callers: `Lessons.publish`, the
  validate endpoint, `apps/web/public/agent/learn.mjs` and
  `apps/worker/scripts/publish.ts`. The two CLIs copied the en-first order, the
  duplicate-language check, the slug and the byte cap; `publish.ts` also ran a
  local preflight that could not resolve concepts or see stored languages.
- Every rule that matters — parity against the stored lesson, parity inside the
  new pair, concept pins, the default language — is a property of the lesson,
  not of one language.

## Decision

- **The primary publish is lesson-level.** `POST /api/me/lessons/:slug/publish`
  takes `{ "specs": [LessonSpec, ...] }` with one or two languages of one
  lesson. It returns 201 with `{ lesson, versions, created: true }` when at
  least one version was written, or 200 with `created: false` when every
  language was already current.
- **One authoring module.** `Lessons.checkBundle` is the read-only half:
  decode, schema, references, concept resolution, kind, duplicate language,
  parity against stored languages, parity inside the set, and pins. Both the
  dry run (`Lessons.validate`) and both publish entry points call it.
  `Lessons.publishBundle` writes.
- **One batch.** All new bodies go to R2 first (immutable and
  content-addressed), then one D1 batch inserts every new `lesson_version`,
  upserts `lesson_lang`, inserts the pins, updates the lesson, and runs
  `syncLessonLangs` once. A failure before the batch leaves at most an
  orphaned R2 object, never a version row without a body, and never a
  half-published lesson.
- **English first, decided by the server.** The module sorts the set, so the
  two CLIs no longer carry a rank table.
- **The old endpoint stays as an adapter.** `POST
  /api/me/lessons/:slug/versions` still accepts one LessonSpec and calls the
  same module with a one-spec set, so a downloaded `learn.mjs` keeps working.
  New clients use the lesson-level endpoint. The adapter can be removed when
  the old CLI has aged out.
- **The CLIs become adapters.** `learn.mjs` sends one publish request for the
  set after the dry run. `scripts/publish.ts` no longer runs a local validator
  or parity check; it parses JSON locally for a clear syntax error, then asks
  the server for the same check (`--dry-run`) or the same publish. `--dry-run`
  now needs a token.

## Why

- The half-published failure cannot be produced by a bundle. The state the CLI
  had to describe ("the earlier language was published") no longer exists.
- A rule change is one edit in `checkBundle`, not four edits that can drift.
  The dry run and publish cannot disagree about the set.
- Parity is checked in both directions that matter: against the stored
  languages the set does not replace, and inside the set. The old per-language
  path could compare a new language only with what was already stored.
- The server owns the order, the caps and the pins. The CLIs only read files
  and call the API, which is what ADR 0010 wanted them to be.

## Cost

- The public publish body changes from one LessonSpec to `{ specs: [...] }`.
  The adapter covers old clients, but there are now two publish routes and a
  period where both must be tested.
- A bundle holds one or two lessons in memory and in one request; the 512 KB
  cap is now the cap on the set, not on each language. A pair that is valid
  one language at a time but over the cap together must be shortened.
- One D1 batch writes both languages. It is larger than a per-language batch,
  but still a handful of statements per language, and it is the only way to
  get the atomicity the lesson-level contract promises.
- The adapter has to keep the old response shape (`{ lesson, version,
  created }`) and the old issue paths (no `specs[i].` prefix), so the two
  response shapes coexist until it is removed.

## As built (2026-10-29)

- `packages/api/src/models.ts`: `PublishedVersion`, `PublishedLesson` and
  `PublishLessonUnchanged`; `packages/api/src/api.ts`: the
  `publishBundle` endpoint.
- `packages/services/src/lessons.ts`: `parseBundle`, `parseSingle`,
  `checkBundle`, `publishSpecs`, `publishBundle`; `publish` and `validate`
  are adapters over the same checks. `nextLessonFtsRowid + i` gives each new
  language its own `lesson_lang.fts_rowid` inside one batch.
- `apps/web/public/agent/learn.mjs`: one publish request for the set.
  `apps/worker/scripts/publish.ts`: server-side preflight and publish; the
  local `packages/domain` validator and `compareTranslations` calls are gone.
- Tests: `apps/worker/test/publish.test.ts` covers a two-language publish,
  one-language-then-pair, unchanged bundles, a refused bundle writing nothing,
  parity against a stored language, and the old adapter;
  `apps/worker/test/agent.test.ts` covers a token bundle publish;
  `apps/worker/test/pinning.test.ts` checks per-language pins in one batch.
