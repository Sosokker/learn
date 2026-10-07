# 0003: Lesson bodies are immutable JSON in R2, named by hash

**Status:** accepted, 2026-10-07

## Decision
Every published version of a lesson (and of a shared concept) is one JSON file in R2 at
`c/<sha256>.json`. D1 stores only the hash, size and metadata. A new version is a new file; a
file is never changed.

## Why
- Lessons are big (30–150 KB). R2 storage is cheap and egress is free; D1 stays small.
- Immutable files cache forever: `/c/<hash>.json` is served with
  `Cache-Control: public, max-age=31536000, immutable`, so after the first read in a region the
  edge serves it with no Worker CPU and no R2 read.
- Identical bodies are stored once (a fork costs nothing until it changes).

## Consequences
- `/c/<hash>.json` must not leak private lessons. The Worker serves a hash only if a public or
  unlisted lesson version (or any concept version) has it; a private body is served only by the
  owner-checked `GET /api/lessons/:id/body/:lang`. Hashes of private bodies are never sent to
  other users.
- If a public lesson becomes private, a body already cached at the edge stays cached until it
  expires. Acceptable: it was public, and the URL is a hash nobody can guess.
