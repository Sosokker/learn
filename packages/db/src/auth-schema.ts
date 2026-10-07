import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

// Better Auth tables (users, sessions, OAuth accounts, verification values, rate limits). They
// hold session tokens and Google OAuth tokens, so only packages/auth (and this package) may import
// this module (`@app/db/auth-schema`; Biome's noRestrictedImports enforces it). App code reads the
// user only through Better Auth's session API or the public `profile` table.
//
// Better Auth talks to D1 through its built-in D1 dialect, which stores dates as ISO-8601 text and
// booleans as 0/1, so those columns are text and integer here. JS keys are the column names;
// packages/auth maps Better Auth's camelCase field names onto them.

const authTimestamps = {
  created_at: text().notNull(),
  updated_at: text().notNull(),
}

export const authUser = sqliteTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  email_verified: integer().notNull().default(0),
  image: text(),
  ...authTimestamps,
})

export const authSession = sqliteTable(
  "session",
  {
    id: text().primaryKey(),
    token: text().notNull().unique(),
    user_id: text()
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    expires_at: text().notNull(),
    ip_address: text(),
    user_agent: text(),
    ...authTimestamps,
  },
  (table) => [index("session_user_id_idx").on(table.user_id)],
)

export const authAccount = sqliteTable(
  "account",
  {
    id: text().primaryKey(),
    account_id: text().notNull(),
    provider_id: text().notNull(),
    user_id: text()
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    access_token: text(),
    refresh_token: text(),
    id_token: text(),
    access_token_expires_at: text(),
    refresh_token_expires_at: text(),
    scope: text(),
    // Unused (Google sign-in only); Better Auth's account model still has the field.
    password: text(),
    ...authTimestamps,
  },
  (table) => [index("account_user_id_idx").on(table.user_id)],
)

export const authVerification = sqliteTable(
  "verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expires_at: text().notNull(),
    ...authTimestamps,
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
)

// Rate-limit counters in D1, so every isolate shares them (Better Auth's default is one isolate's
// memory). `last_request` is epoch milliseconds.
export const authRateLimit = sqliteTable("rate_limit", {
  id: text().primaryKey(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  last_request: integer().notNull(),
})
