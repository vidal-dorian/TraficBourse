// `npm run db:migrate`: applies the committed Drizzle migrations to the database at
// DATABASE_PATH (created if missing) and leaves it in WAL mode.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase, resolveDatabasePath } from "./client";

/** Same folder as `out` in drizzle.config.ts, relative to the repo root (npm scripts run there). */
const MIGRATIONS_FOLDER = resolve("src/lib/db/migrations");

// Same configuration source as `next dev`: a local `.env`, without overriding the environment.
if (existsSync(".env")) process.loadEnvFile(".env");

const databasePath = resolveDatabasePath();
const sqlite = openDatabase(databasePath);
try {
  migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });
  const journalMode = sqlite.pragma("journal_mode", { simple: true });
  console.log(`Migrations applied to ${databasePath} (journal_mode=${String(journalMode)})`);
} finally {
  sqlite.close();
}
