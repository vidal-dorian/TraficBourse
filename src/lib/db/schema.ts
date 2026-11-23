// Drizzle schema of the app; see CLAUDE.md §6 for the data model.
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { BRIEF_KINDS, CATEGORIES, MOODS } from "../schemas/brief-enums";

/**
 * Technical key/value settings of the app (no business data). It also gives the first
 * migration something to create, so the migration chain starts from a real schema.
 */
export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * One row per MCP tool call (CLAUDE.md §7): which tool, whether it succeeded, a short error
 * and how long it took. Never the call's arguments nor its result.
 */
export const mcpAudit = sqliteTable("mcp_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tool: text("tool").notNull(),
  ok: integer("ok", { mode: "boolean" }).notNull(),
  error: text("error"),
  durationMs: integer("duration_ms").notNull(),
  at: integer("at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * One brief per date and kind (CLAUDE.md §6). Republishing updates the row in place, so its id
 * stays stable for the tables referencing it. `raw_payload` is the JSON exactly as received,
 * kept to re-render a brief after a design change.
 */
export const briefs = sqliteTable(
  "briefs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    kind: text("kind", { enum: BRIEF_KINDS }).notNull(),
    status: text("status", { enum: ["draft", "published"] })
      .notNull()
      .default("draft"),
    tldr: text("tldr").notNull(),
    mood: text("mood", { enum: MOODS }).notNull(),
    rawPayload: text("raw_payload").notNull(),
    publishedAt: integer("published_at", { mode: "timestamp" }),
  },
  (table) => [unique("briefs_date_kind_unique").on(table.date, table.kind)],
);

/** News items of a brief, `rank` following the payload order (1 = first). */
export const newsItems = sqliteTable(
  "news_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    briefId: integer("brief_id")
      .notNull()
      .references(() => briefs.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    whyItMatters: text("why_it_matters").notNull(),
    impact: text("impact").notNull(),
    category: text("category", { enum: CATEGORIES }).notNull(),
    tickers: text("tickers", { mode: "json" }).$type<string[]>().notNull(),
    sourceName: text("source_name").notNull(),
    sourceUrl: text("source_url").notNull(),
  },
  (table) => [unique("news_items_brief_rank_unique").on(table.briefId, table.rank)],
);

/** Public OAuth clients registered dynamically (RFC 7591) by the Claude connector. */
export const oauthClients = sqliteTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  redirectUris: text("redirect_uris", { mode: "json" }).$type<string[]>().notNull(),
  clientName: text("client_name"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Authorization codes waiting to be exchanged. Only the SHA-256 hash of the code is stored;
 * `expires_at` is in milliseconds since the epoch, `used` is 0 or 1.
 */
export const oauthCodes = sqliteTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.clientId, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  expiresAt: integer("expires_at").notNull(),
  used: integer("used").notNull().default(0),
});

/**
 * Access and refresh tokens issued to a client. Only the SHA-256 hash is stored;
 * `expires_at` is in milliseconds since the epoch, `revoked` is 0 or 1.
 */
export const oauthTokens = sqliteTable("oauth_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  kind: text("kind", { enum: ["access", "refresh"] }).notNull(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.clientId, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  revoked: integer("revoked").notNull().default(0),
});
