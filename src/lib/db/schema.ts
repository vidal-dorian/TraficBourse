// Drizzle schema of the app; see CLAUDE.md §6 for the data model.
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { BRIEF_KINDS, CATEGORIES, CHART_RANGES, MOODS, STOCK_NOTE_REASONS } from "../schemas/brief-enums";

/** The chart spec of a news item as stored (see `ChartSpec` in schemas/brief.ts). */
export type StoredChartSpec = { type: "price"; symbols: string[]; range: (typeof CHART_RANGES)[number]; normalize: boolean };

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
    /** The chart spec as validated (`normalize` defaulted), null for a news item without chart. */
    chartSpec: text("chart_spec", { mode: "json" }).$type<StoredChartSpec>(),
  },
  (table) => [unique("news_items_brief_rank_unique").on(table.briefId, table.rank)],
);

/** Notes on watchlist stocks of a brief (« Ma watchlist »), in payload order (`id` order). */
export const stockNotes = sqliteTable("stock_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  briefId: integer("brief_id")
    .notNull()
    .references(() => briefs.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  reason: text("reason", { enum: STOCK_NOTE_REASONS }).notNull(),
  summary: text("summary").notNull(),
  newsRefs: text("news_refs", { mode: "json" }).$type<string[]>().notNull(),
  nextEvent: text("next_event"),
}, (table) => [index("stock_notes_brief_id_idx").on(table.briefId)]);

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
 * `expires_at` and `granted_at` (the original login, carried over on refresh) are in milliseconds
 * since the epoch, `revoked` is 0 or 1. `credential` is the random id of the owner's password generation
 * the token was issued under: changing the password invalidates every token. `code_hash` is the
 * authorization code the token descends from, so a replayed code can revoke what it produced.
 */
export const oauthTokens = sqliteTable("oauth_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  kind: text("kind", { enum: ["access", "refresh"] }).notNull(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.clientId, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  grantedAt: integer("granted_at").notNull(),
  credential: text("credential").notNull(),
  codeHash: text("code_hash").notNull(),
  revoked: integer("revoked").notNull().default(0),
});

/** Kinds of tracked instruments (CLAUDE.md §6). */
export const INSTRUMENT_TYPES = ["index", "etf", "stock", "fx", "crypto", "commodity"] as const;

/**
 * The tracked universe (CLAUDE.md §6). `symbol` is the app's own key, `provider_symbol` the one
 * the market-data provider knows (the same for Yahoo today). `fallback_symbol` is the symbol of the
 * Twelve Data fallback (US #19), null when its free tier does not cover the instrument. The default
 * ones are seeded by a migration.
 */
export const instruments = sqliteTable("instruments", {
  symbol: text("symbol").primaryKey(),
  providerSymbol: text("provider_symbol").notNull(),
  name: text("name").notNull(),
  type: text("type", { enum: INSTRUMENT_TYPES }).notNull(),
  exchange: text("exchange"),
  currency: text("currency").notNull(),
  inWatchlist: integer("in_watchlist", { mode: "boolean" }).notNull().default(false),
  fallbackSymbol: text("fallback_symbol"),
  // Most recent results publication date (US #25), filled by the prices job for watchlist stocks.
  lastEarningsDate: text("last_earnings_date"),
});

/**
 * Closing history, one row per instrument and day (`date` is the exchange's local day,
 * "YYYY-MM-DD"). Written only by the prices job, never by Claude.
 */
export const pricesDaily = sqliteTable(
  "prices_daily",
  {
    symbol: text("symbol")
      .notNull()
      .references(() => instruments.symbol, { onDelete: "cascade" }),
    date: text("date").notNull(),
    open: real("open"),
    high: real("high"),
    low: real("low"),
    close: real("close").notNull(),
    volume: integer("volume"),
  },
  (table) => [primaryKey({ columns: [table.symbol, table.date] })],
);
