# 0010. Bring your own harness: agents publish, the platform validates and renders

- Status: accepted; the per-language publish endpoint is superseded in part by ADR 0011
- Date: 2026-10-29
- Supersedes: ADR 0009 (hosted generation with pi in a Durable Object)

## Context

ADR 0009 made lesson creation a hosted feature: `/create` started a job, a
Durable Object ran pi's agent loop, and every user supplied an encrypted
provider key (BYOK) or spent a small platform quota. That shipped, but the
owner changed the direction:

- Users already have Claude Code, OpenCode, Codex or pi. They want to use those
  harnesses, their own subscriptions and their own context, not paste a provider
  key into Learn.
- The platform should own the lesson format, validation, storage, rendering and
  community. It should not run a model, store provider keys, or pay per token.
- A hosted agent duplicates the harness the user already has, and a Durable
  Object per job is a large surface to keep for a feature that can be a file on
  disk.

Facts checked on 2026-10-29:

- `POST /api/me/lessons/:slug/versions` already accepts a LessonSpec JSON with
  an `lrn_…` API token and validates it with the same `@app/domain` code the
  renderer and the seed use (ADR 0008).
- `packages/domain` exports a strict LessonSpec JSON Schema and a validator
  that checks ids, links, expressions, ranges and en/th parity.
- Claude Code, OpenCode, Codex and pi can all run a shell command and read a
  project instruction file (`SKILL.md`, `AGENTS.md`). All of them can read a
  local JSON file, which keeps a 30–150 KB lesson out of tool-call arguments.
- The hosted path is: `KeysApi`, `GenerationsApi`, `ByokKeys`,
  `Generations`, `GenerationJobs`, `GenerationSettings`, `packages/agent`, the
  `GenerationAgent` Durable Object, SSE events, quota rows and the `/create`
  form.
- MCP is available in some harnesses, but a lesson body travels through tool
  arguments, so the model pays to emit and re-read the same 30–150 KB on every
  call. A file plus a CLI avoids that.

## Decision

- **Remove hosted generation and BYOK.** No model runs in the Worker, no
  provider keys are stored, and there is no generation quota, job row, SSE
  stream or Durable Object. A new migration drops `byok_key`, `generation_job`
  and `generation_usage`; a Wrangler `deleted_classes` migration removes the
  `GenerationAgent` class.
- **Creation is the user's harness.** The learner runs Claude Code, OpenCode,
  Codex or pi in their own project. The platform provides a stable contract:
  - `/agent/SKILL.md`: the authoring workflow, format essentials, parity and
    publishing rules, and the CLI commands. `learn init` writes it into the
    harness's conventional path.
  - `/agent/learn.mjs`: a dependency-free Node 18+ CLI for `guide`, `schema`,
    `search`, `concept`, `validate`, `publish` and `init`.
  - `GET /api/agent/lesson-schema`: the strict LessonSpec JSON Schema, public
    and cached, generated from the deployed code.
  - `POST /api/me/lessons/:slug/validate`: the publish checks without a write
    (`{ "specs": [en, th] }`). Invalid input is a 200 with `issues`, because
    fixing them is the normal path.
- **Publishing is unchanged.** `POST /api/me/lessons/:slug/versions` with one
  LessonSpec per language, authenticated by the existing `lrn_…` token.
  Lessons start private; the user chooses visibility in Library. A directory
  of `en.json` and `th.json` is validated together, then published in order.
  (ADR 0011 replaces this with a lesson-level `POST
  /api/me/lessons/:slug/publish`; the old route remains as an adapter.)
- **No MCP server in v1.** The skill and CLI are the portable surface. MCP can
  wrap the same validate/publish API later without changing the format.
- **Tokens keep their current scope.** An agent token can do what its user can
  do except manage tokens, exactly as pi's token does today. A narrower
  publish-only scope is a possible later addition, not part of this change.

## Why

- The platform's cost stays at infrastructure only. No provider key is stored,
  no model is run, and no quota needs a billing decision.
- One contract (`LessonSpec` + the validator) is shared by the CLI, the server,
  the renderer and `content/`. There is no second agent tool set to drift.
- The user's existing harness has their context, their model choice and their
  subscription. Learn does not have to reproduce it.
- A file-based CLI handles large lessons without paying tokens twice, and works
  in every harness because every harness has a shell.
- Deleting the hosted path removes the largest security surface in the app
  (encrypted provider keys) and the pi/DO dependency.

## Cost

- Users without a harness cannot create a lesson on the site. The guide, the
  CLI and the skill must be good enough for a first lesson.
- The agent token is broad (the same as pi's). A malicious repository could
  read it and act as the user until it is revoked.
- The CLI is a second copy of the publishing workflow. It is deliberately thin:
  it reads files and calls the server, so validation stays server-authoritative.
- The skill is prose, so it can drift from the schema. The `schema` command and
  the dry run are the source of truth; a test keeps the serve path working.
- There is no live progress UI. The harness shows its own progress; Learn
  shows the private draft when publishing finishes.

## As built (2026-10-29)

- `apps/web/public/agent/SKILL.md` and `learn.mjs` are served as static assets.
  `learn init claude|opencode|codex|pi|generic` writes the skill to
  `.claude/skills/learn/SKILL.md`, `.opencode/skills/learn/SKILL.md`,
  `.learn/SKILL.md` (and an `AGENTS.md` pointer for Codex/pi).
- `GET /api/agent/lesson-schema` (public) serializes the Effect JSON Schema
  document as draft-2020-12 with `$defs` restored.
- `POST /api/me/lessons/:slug/validate` takes raw JSON bytes, shares the
  publish body limit, and returns `{ valid, issues }`. `Lessons.check` is the
  read-only half of `Lessons.publish`, so the two cannot disagree.
- `/create` is now a setup page: token, harness, export, example prompt,
  preview. The old form, job history and BYOK card are gone.
- Removed: `packages/agent`, the `GenerationAgent` DO and runner, SSE, BYOK
  services and routes, generation services, quota, `/generations`, the
  `/me/keys` routes, the `/create` form, `GENERATION_*` and `BYOK_KEK`
  settings, and their tests.
- Tests: `apps/worker/test/agent.test.ts` covers the dry run (valid, issues,
  parity, duplicate languages, existing-language parity, token auth, body
  limit, public schema). `e2e/tests/agent.spec.ts` covers the public assets and
  the `/create` setup page. The CLI was exercised against a local Worker:
  validate, publish, unchanged republish, parity refusal, and `init` for Claude
  Code and Codex.

> ADR 0011 keeps this contract but replaces the per-language publish endpoint
> with a lesson-level one. The harness, token and no-hosted-model decisions
> above still stand.

