---
name: learn
description: Write, validate and publish a Learn lesson (a typed LessonSpec JSON) to learn.sirin.dev. Use when the user asks to create, update or publish a lesson, explainer or course on Learn.
---

# Learn lessons

Learn renders typed lesson JSON. It does not run an LLM: **you** write the lesson with this
harness, and the platform validates, stores and renders it. The user pays for their own model.

## Setup

The user needs an API token from `<origin>/settings` (it starts with `lrn_`). Export it; never
put it in a lesson, a commit or chat output.

```bash
export LEARN_TOKEN=lrn_…            # the user's token
export LEARN_URL=https://learn.sirin.dev   # optional; the CLI defaults to this
node learn.mjs guide > guide.en.json       # the canonical example (fetch once)
node learn.mjs schema > lesson-schema.json # the exact JSON Schema
```

`learn.mjs` is served at `<origin>/agent/learn.mjs`. If it is missing, fetch it:

```bash
curl -fsSL "$LEARN_URL/agent/learn.mjs" -o learn.mjs
```

## Workflow

1. **Read the guide.** `guide.en.json` is a complete, valid lesson that uses most section types.
   Read it before writing. Fetch `guide.th.json` too when translating.
2. **Choose a kind.** `solve` (one problem), `learn` (a topic), `situation` (a scenario),
   `code`, or `proof`. Do not use `guide`; that kind is reserved for the platform.
3. **Reuse shared concepts.** Before writing a card that explains a standard idea (a law,
   definition or formula), search:
   ```bash
   node learn.mjs search "average speed" --lang en
   node learn.mjs concept physics.average-speed
   ```
   If a concept fits, use `{ "concept": "physics.average-speed" }` as the card entry. Keep a
   local card id, because the lesson's `{cardId|…}` links use it.
4. **Write both languages.** A lesson has one `en` and one `th` file, e.g.
   `my-lesson/en.json` and `my-lesson/th.json`. The structure must be identical: same parts,
   card ids, section ids, section types and order, widget shapes and links. Only prose differs.
   If the user did not ask for Thai, write Thai prose anyway (or ask); a lesson can be published
   with only one language, but parity is checked against the published languages.
5. **Validate before writing anything.**
   ```bash
   node learn.mjs validate my-lesson --slug my-lesson
   ```
   A directory sends all `.json` files together, so cross-language parity is checked. Fix every
   issue and run it again. `specs[0]` is the first file in the directory listing (`en.json`
   first, then `th.json`).
6. **Publish as a private draft.**
   ```bash
   node learn.mjs publish my-lesson --slug my-lesson
   ```
   The CLI validates the whole set again, then sends both files in one request.
   The server checks them together and writes every new version in one batch, so
   a failure in either language writes nothing. The first publish creates a
   private lesson; later publishes add versions. The output gives the preview
   URL (`/@handle/my-lesson`). The user changes visibility in Library; do not try
   to make it public for them.
7. **Iterate.** Edit the files, validate, publish again. Old versions stay readable.

`--dry-run` with `publish` validates only; both commands need `LEARN_TOKEN`.

## The LessonSpec

Top level:

```json
{
  "schema": 1,
  "kind": "learn",
  "lang": "en",
  "title": "Average speed",
  "summary": "Why the answer is not the mean of the two speeds.",
  "parts": {},
  "cards": {},
  "sections": []
}
```

- `title` ≤ 160 characters; `summary` ≤ 280; the whole lesson ≤ 512 KB.
- **Parts** are the colored pieces of the lesson. Each has an id, `label` (may contain `$tex$`),
  `role`, `color`, `meaning` (≤ 200), and optional `body`, `example`, `analogy`. Roles:
  `given`, `hidden_given`, `goal`, `derived`, `constant`, `condition`, `actor`, `metric`,
  `variable`, `concept`. One color means one thing in a lesson. Use a color twice only for the
  same meaning.
- **Cards** are the drill-down explanations. A card is either a local card
  (`kind`, `title`, `body`, optional `kicker`, `says`, `from`, `useWhen`, `units`, `example`,
  `analogy`) or a shared concept (`{ "concept": "physics.average-speed" }`). Card kinds: `term`,
  `law`, `formula`, `def`, `lemma`, `thm`, `metric`, `story`, `feature`. At most 64 cards.
- **Sections** each have `id`, `type`, an optional `title`/`note`, and the type's fields. The
  types are `text`, `problem`, `chunks`, `concept`, `plan`, `chain`, `proof`, `graph`, `visual`,
  `check`, `story`, `units`, `recall`. The JSON Schema and the guide have every field; do not
  invent fields. Unknown keys are rejected.
- **Widgets** (inside a `visual` section) are `plot`, `table`, `flow`, `incline` and `trace`.
  They are data, not code. See the schema/guide for their parameters.

### Rich text

Inside `body`, `title`, `move`, `why` and the other rich fields:

| Syntax | Meaning |
|---|---|
| `[partId:label]` | link to a part (label may contain `$tex$`) |
| `{cardId\|label}` | link to a card (drill-down) |
| `$tex$` / `$$tex$$` | inline / display math (KaTeX) |
| `**bold**`, `*italic*`, `` `code` `` | formatting |
| `\p{partId}{tex}` | a hoverable symbol inside TeX, linked to a part |

There is **no HTML and no JavaScript**. A shared lesson must stay safe.

### Ids

Ids match `^[a-z][a-z0-9_]{0,31}$` and are stable across translations: `@` references and
comments point at `<lesson>/<sectionId>.<itemId>` in every language. Use short, semantic ids
(`given_speed`, `step_1`, `why_stop`), not numbers.

### Parity rules the validator enforces

- Same `kind`, part ids, card ids and section ids/types/order in every language.
- Same part `role` and `color`; same card kind (or the same concept slug).
- Same links (`[part:…]`, `{card|…}`, `\p{part}{…}`) in the same fields.
- Same widget shape. Only prose may differ.

## Commands

```bash
node learn.mjs guide [--lang en|th]          # print the canonical lesson
node learn.mjs schema                        # print the LessonSpec JSON Schema
node learn.mjs search "<words>" [--lang …]   # shared concepts
node learn.mjs concept <slug> [--lang …]     # one concept and its card
node learn.mjs validate <file|dir> [--slug]  # no writes
node learn.mjs publish <file|dir> [--slug]   # private lesson + new version
node learn.mjs init <harness>                # write this skill into the project
```

`--url` overrides the origin; `--token` overrides `LEARN_TOKEN`; `--json` prints raw answers.

## Refusals

- `401`: the token is unknown or revoked. Ask the user for a new one at `/settings`.
- `413`: the bundle is over 512 KB. Shorten the lesson; the whole set is checked as one unit.
- `422` on publish: the set changed between validate and publish (a concept moved, or another
  writer updated the lesson), or the token is not the owner. Read `issues`, fix the files, run
  validate again. A refused bundle writes nothing, so there is no half-published lesson.
- `429`: rate limited; wait a minute.

The server is the authority. If `validate` says valid, publish should succeed; if it does not,
report the issues to the user instead of guessing.
