# 0009. AI lesson creation: pi's agent loop in a Durable Object

- Status: superseded by [ADR 0010](0010-bring-your-own-harness.md) on 2026-10-29.
  The hosted generation and BYOK stack described here was removed; the agent loop
  now runs in the user's own harness. Kept as history.
- Date: 2026-10-11

## Context

Phase 2 lets website users create lessons with an LLM. Today lessons are written
locally with pi and published with an API token (ADR 0008). The owner wants an
agent with a fixed set of tools, many users, and low cost through prompt caching.

Facts checked on 2026-10-11:

- pi's full coding agent (`pi-coding-agent`) is built around a filesystem and a
  shell. On Cloudflare it would need a container per run.
- `@earendil-works/pi-ai` + `pi-agent-core` 1.1.0 run in a Durable Object. A
  spike bundled them (205 KiB gzip, `nodejs_compat`) and ran a tool loop against
  a fake Anthropic endpoint with no Node errors. Other providers' modules and the
  real APIs are not tested yet.
- pi-ai's `cacheRetention: "long"` puts `cache_control` (ttl 1h) on the system
  block, the last tool and the last user message, and reports `cacheRead` /
  `cacheWrite` per call.
- Waiting on the model is not Worker CPU time. Durable Objects keep state in
  their own SQLite and can hold a WebSocket to the browser.
- Prompt caches are per provider account (workspace). A cache read costs about
  0.1x input. Changing tools, `tool_choice` or the structured-output format
  breaks the cache.
- The owner's one real pi lesson session read 87% of its tokens from cache.

## Decision

- The agent loop is `pi-agent-core` with `pi-ai` streams, inside one Durable
  Object per generation job. No container, no shell.
- Multi-provider through pi-ai (Anthropic, OpenAI, DeepSeek-class models). The
  model list is server config, not user input (except BYOK, below).
- One fixed tool set for every user and every job:
  `search_concepts(q)`, `get_concept(slug)`, `validate_lesson(spec)` (pure,
  returns issues from `packages/domain`), `save_draft(spec)` (private, owned by
  `CurrentUser`). Tools never take a user id. The user, not the model, publishes.
- Prompt layout: tools, then system (guide, the LessonSpec JSON Schema as text,
  one example lesson), cached 1h. No timestamps, names or ids in that prefix. It
  changes only on deploy.
- No structured output for the whole LessonSpec: unions and nesting hit the
  schema limits, and a format change breaks the cache. The model calls
  `validate_lesson` and repairs.
- Cheaper models for small jobs (drill-down cards, Thai translation, fixes);
  Batch APIs (50% off) for jobs nobody waits on.
- Billing: both. A platform-paid daily quota per user, and BYOK for heavy users
  (key stored encrypted, used only inside the Durable Object).
- Limits: max turns, max output tokens, and a per-user daily budget in D1.
  Token usage (input, output, cache read, cache write, cost) is stored per job.

## Why

The loop is small and needs no shell, so a Durable Object is enough and costs far
less than a container. pi-ai gives provider choice and caching controls without
writing per-provider code. A fixed tool set and a stable prefix keep the cache
shared across all platform-paid users.

## Cost

- A young dependency that recently moved npm scope; pin it and keep the loop
  thin so it can be replaced by plain `fetch` calls.
- BYOK users get no shared cache, and key storage is a security surface.
- Validate-and-repair costs extra turns compared with constrained decoding.

## As built (2026-10-11)

What changed from the decision above, and the choices it left open:

- **Packages.** The loop, tools, prompt and fake provider are `packages/agent`.
  Job rows, quota and keys are services (`Generations`, `GenerationJobs`,
  `ByokKeys`, `GenerationSettings`). The Durable Object is
  `apps/worker/src/generation-agent.ts`; the Worker reaches it through the
  `GenerationRunner` seam, and tests run the same job code in-process.
- **pi 1.1.0** (pinned, latest on 2026-10-11). Streams come from
  `@earendil-works/pi-ai/api/anthropic-messages` and `.../openai-completions`;
  models are built by hand from config; `apiKey` and `cacheRetention` are
  always passed, never read from the environment.
- **Providers.** Anthropic (Messages) and OpenAI-compatible Chat Completions
  (OpenAI, DeepSeek). Both bundle in workerd. The Anthropic module ran in
  workerd against the fake provider; the Chat Completions module ran in Node
  tests only. No real provider API was called.
- **Fetch-based Durable Object**, not RPC: a plain class with `fetch` and
  `alarm`, so the Worker module still imports in Node tests. The run happens in
  the alarm handler (not tied to the request that started it), with a
  10-minute wall-clock limit (past it the job fails as "timed out"). An alarm
  that finds the job already "running" (eviction or deploy mid-run) fails it
  instead of running it twice. Its tables are created on use, because the
  transcript's expiry (`deleteAll`) drops them while the instance lives on.
  `limits.cpu_ms` is 300000: pi-ai re-parses the whole tool-call JSON on every
  streamed chunk, so CPU grows with the square of the lesson's size.
- **Progress is SSE** through the Worker (`GET /api/generations/:id/events`):
  cookie auth and `connect-src 'self'` work unchanged, and `Last-Event-ID`
  resumes after a reconnect. The transcript stays in the object's SQLite for
  24 hours; the D1 row keeps the result after that.
- **save_draft without arguments** saves the spec `validate_lesson` last
  accepted, so the model does not write the whole lesson a third time. Tool
  parameters refuse unknown keys.
- **Billing at launch: BYOK only.** No provider key secret is set, so no model
  has platform billing; the API refuses it (`PlatformBillingUnavailable`) and
  `/create` shows neither a quota nor a "who pays" choice, only the user's key
  or a link to add one. Setting a provider's key secret turns the quota on for
  that provider's models, with no code change.
- **Quota** counts platform jobs per user per UTC day (`GENERATION_DAILY_JOBS`)
  in a counter row. A job that fails or is canceled before the provider
  charged anything gives its count back; once tokens were used it never does,
  and the usage saved after each request is kept even when our side fails.
  One active job per user. The day's spend is also added to the row; it is
  not a limit yet.
- **Starting and canceling a job need the session cookie**, like key
  management: an API token (ADR 0008) can read jobs but cannot spend money.
- **Broken AI settings** (a bad `BYOK_KEK`, `GENERATION_MODELS` or limit) turn
  generation off with `GenerationUnavailable` (503), logged once, instead of
  failing every route of the Worker.
- **Cache retention:** `long` for platform jobs, `short` for BYOK. On
  Anthropic the 1-hour mark stays on the prefix (tools, system) and the
  conversation tail is rewritten to the 5-minute mark (`onPayload`), since the
  tail is read back within seconds. Cost is ours, not pi's: `costOf` prices
  the 1-hour writes Anthropic reports at the model's `cache_write_1h`.
  OpenAI-compatible models get `supportsLongCacheRetention: false`: DeepSeek
  gets no cache fields, OpenAI gets the shared `prompt_cache_key` but no 24h
  retention (only some models accept it). `reasoning: false` does not stop an
  OpenAI reasoning model from reasoning; those tokens are output.
- **Errors shown to users** are the provider's HTTP status in plain words plus
  its short message, or a generic "something went wrong on our side". Our own
  failures (D1, R2, bugs) go to the log only.
- **Stored keys carry `kek_version`** (migration 0012), so `BYOK_KEK` can be
  rotated later without a big-bang re-encryption.
- **Not built:** cheaper models per sub-task, Batch APIs, a daily cost cap per
  user or for the whole platform, KEK rotation itself.
