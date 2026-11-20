// Drizzle schema of the app. Business tables (briefs, news_items, ...) arrive in phase 1;
// see CLAUDE.md §6 for the data model.
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
