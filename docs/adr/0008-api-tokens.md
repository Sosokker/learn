# 0008. API tokens for pi

- Status: accepted
- Date: 2026-10-11

## Context

pi (a local agent) publishes lessons. It has no browser, so it cannot hold the
Better Auth session cookie (ADR 0007). The `api_token` table existed from the
first migration, unused. D1 bills rows read and written, and the cookie path
already guards against cross-site requests and spends a per-user write budget.

## Decision

- A token is `lrn_` + 32 random bytes in base64url (43 characters). It is
  shown once, in the create response (`no-store`). D1 stores its sha256
  (unique index) and a display prefix: `lrn_` + 6 characters (migration
  `0006_api_tokens` adds `prefix` and a partial index on active tokens).
- `Authorization: Bearer <token>` is accepted by `Authenticated` and by
  `Viewer`. `Viewer` takes it so pi can read back its own private lesson (body,
  versions) after publishing; a bad token there reads as anonymous, like a
  broken cookie.
- Precedence: when an `Authorization` header is present, it is the only
  credential checked. A bad token is 401 even next to a valid cookie. A request
  that sends a token means that token; falling back to the browser session
  would hide a revoked or mistyped token.
- Token requests skip the cross-site check (`Origin` / `Sec-Fetch-Site`): a
  browser never attaches the header by itself, so another site cannot ride on
  it. They still spend the user's write budget (`WRITE_LIMIT`, keyed by user
  id, shared with the cookie).
- `/api/me/tokens` (list, create, revoke) uses a separate middleware,
  `SessionAuthenticated`: cookie only. A token, even with a cookie beside it,
  gets 401 there. So a leaked token cannot mint more tokens or revoke the
  owner's others.
- At most 10 active tokens per user. The cap and the insert are one statement
  (`insert … select … where (select count(*) …) < 10`), so racing creates
  cannot pass it. Over the cap is 409 `ApiTokenLimit`. This `count(*)` is an
  allowed exception to the no-`COUNT(*)` rule: it reads at most 10 rows of the
  partial active-token index, and a counter column could not refuse a race in
  the same statement.
- Admin powers (`ADMIN_USER_IDS`) need the session cookie. An admin's token is
  a plain user: it gets the admin endpoints' 404, sees hidden comments only as
  their author or the lesson owner would, and `/api/me` says `is_admin: false`.
- Revoke sets `revoked_at` (owner only; anything else is 404
  `ApiTokenNotFound`). The list and the cap read only active rows, through the
  partial index.
- `last_used_at` is written only when it is older than 5 minutes, so a burst of
  publishes costs one write per token.
- The token service (`ApiTokens`) is in `packages/auth`, not
  `packages/services`, because verifying a token reads the Better Auth `user`
  row.
- `scripts/publish.ts` (bun) reads `LEARN_TOKEN`, validates with
  `packages/domain`, and posts each language.

## Why

- A hash-only store means a D1 leak gives no usable tokens. 256 random bits
  need no slow hash; sha256 makes the lookup one unique-index read.
- Tokens are not scoped: pi needs publish, and also reading back and changing
  its own lessons. Scopes can be added later as a column without changing the
  token format.
- The `lrn_` prefix lets secret scanners find leaked tokens.

## Cost

- A token can do everything the user can through the API except manage
  tokens: change lesson settings, delete lessons, change the handle.
- Tokens do not expire. The user must revoke a token they no longer use.
  `last_used_at` helps them see which ones.
- Every bearer request reads one D1 row (no cookie cache equivalent).
