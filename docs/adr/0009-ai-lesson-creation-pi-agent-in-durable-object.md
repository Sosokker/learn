# 0009. AI lesson creation: pi's agent loop in a Durable Object

- Status: proposed (not built)
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
