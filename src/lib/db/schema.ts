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
