// `npm run db:seed-concepts`: fills (or refreshes) the learning path in the database at
// DATABASE_PATH, which must already be migrated. Safe to run again: see `seedConcepts`.
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { seedConcepts } from "@/lib/concepts/seed";
import { CONCEPTS } from "@/lib/concepts/data";
import { openDatabase, resolveDatabasePath } from "./client";
import * as schema from "./schema";

// Same configuration source as `db:migrate`: a local `.env`, without overriding the environment.
if (existsSync(".env")) process.loadEnvFile(".env");

const databasePath = resolveDatabasePath();
const sqlite = openDatabase(databasePath);
try {
  seedConcepts(drizzle(sqlite, { schema }));
  console.log(`${CONCEPTS.length} concepts seeded in ${databasePath}`);
} finally {
  sqlite.close();
}
