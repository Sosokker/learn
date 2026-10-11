# 0007. Better Auth, Google only, on the native D1 binding

- Status: accepted
- Date: 2026-10-07

## Context

The template uses Better Auth with email + password, organizations and SSO on
Postgres. Here the user chose Google sign-in only. The database is D1. The plan
was Better Auth's Drizzle adapter.

## Decision

- Better Auth 1.7.7, configured in `packages/auth/src/auth.ts`, mounted at
  `/api/auth/*`. Only the Google provider is on (`prompt: select_account`).
  Email + password is off.
- Better Auth gets the D1 binding itself. It detects D1 and uses its built-in
  Kysely D1 dialect: no Drizzle adapter and no extra driver. Its tables
  (`user`, `session`, `account`, `verification`, `rate_limit`) are declared in
  `packages/db/src/auth-schema.ts` with snake_case columns, so they are part of
  the normal migrations.
- One Better Auth instance per isolate, built when the Worker starts.
  `validateSchema` is off at runtime (it would read every auth table on each
  cold start). `apps/worker/test/auth.test.ts` runs that check against the
  migrated schema instead.
- `cookieCache` (5 minutes) keeps most signed-in requests off the session
  table. Rate limits are always on and stored in D1, so all isolates share
  them.
- A user-create hook makes the `profile` row (unique handle). A session-create
  hook repairs it if the first hook failed (D1 has no transaction around
  both).
- `BETTER_AUTH_SECRET` is checked on start: the public dev/test secrets are
  refused unless `APP_ENV` is `dev` or `test`.

## Why

- Google only: no passwords to hash on Worker CPU, no email service for
  resets or verification.
- The native binding is simpler than the adapter and needs no extra package.

## Cost

- Users without a Google account can't sign in.
- Sign-out on one device takes up to 5 minutes to reach another device that
  holds the cookie cache.
- pi can't use a browser session. It publishes with API tokens instead
  (ADR 0008).
