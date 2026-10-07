# 0003. Immutable, content-addressed lesson bodies in R2, served at /c/

- Status: accepted
- Date: 2026-10-07

## Context

A lesson version never changes after it is published. Readers fetch the body
many more times than authors publish it. Rendering happens in the browser, so
the Worker only needs to hand out JSON. Some lessons are private.

## Decision

- On publish, the server decodes the spec, serializes it again
  (`canonicalJson`), and stores it at R2 key `c/<sha256>.json`. The put is
  skipped if the object exists. `lesson_version.body_hash` and
  `concept_version.body_hash` point at it.
- `GET /c/<hash>.json` serves the body with
  `Cache-Control: public, max-age=31536000, immutable`, and the Worker also puts
  it in the edge cache (`caches.default`), keyed by the path alone.
- A hash is served only if it belongs to a non-deleted public or unlisted
  lesson version, or to a concept version (`ContentAccess`). Otherwise 404.
- A private body is read only through
  `GET /api/lessons/:id/versions/:versionId/body`, which checks the owner and
  sends `private, no-store`.

## Why

- After the first read in a region, the edge cache answers. `/c/*` is in
  `run_worker_first`, so the Worker still runs and the request is still billed,
  but it reads no R2 object and no D1 row.
- Same content, same key: publishing identical content again stores nothing
  new, and a future fork can point at the same hash.
- Old versions stay readable for comments anchored to them.

## Cost

- **Cache caveat:** once a body was served from `/c/`, browsers and the edge
  can keep it for up to a year. If the owner later makes the lesson private or
  deletes it, anyone who already has the URL can still read that version. The
  hash can't be guessed, and a lesson that was never unlisted or public never
  reaches `/c/`. To really withdraw a body, the edge cache entry must be purged
  by hand. Browser copies can't be purged.
- Bodies are never deleted from R2 (another lesson may share a hash). Cleanup
  of unreferenced objects would need a separate job.
- The edge cache needs the custom domain. On `workers.dev` the Cache API does
  nothing.
