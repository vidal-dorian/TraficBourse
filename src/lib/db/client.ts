import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

/** Used when `DATABASE_PATH` is not set (local development). */
export const DEFAULT_DATABASE_PATH = "./data/bourse.db";

/** How long a connection waits for a lock held by the other process (web or jobs). */
const BUSY_TIMEOUT_MS = 5_000;

export type Db = BetterSQLite3Database<typeof schema>;

/** Absolute path of the database file, from `DATABASE_PATH` or the local default. */
export function resolveDatabasePath(env: Record<string, string | undefined> = process.env): string {
  const configured = env.DATABASE_PATH?.trim();
  return resolve(configured ? configured : DEFAULT_DATABASE_PATH);
}

/**
 * Opens the SQLite file (creating it and its parent folder if needed) in WAL mode,
 * so that the web and jobs processes can share it.
 */
export function openDatabase(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    sqlite.pragma("foreign_keys = ON");
  } catch (error) {
    sqlite.close();
    throw error;
  }
  return sqlite;
}

let connection: { sqlite: Database.Database; db: Db } | undefined;

function getConnection(): { sqlite: Database.Database; db: Db } {
  if (!connection) {
    const sqlite = openDatabase(resolveDatabasePath());
    connection = { sqlite, db: drizzle(sqlite, { schema }) };
  }
  return connection;
}

/** The shared Drizzle client, opened on first use. */
export function getDb(): Db {
  return getConnection().db;
}

/** The underlying better-sqlite3 connection (pragmas, health checks). */
export function getSqlite(): Database.Database {
  return getConnection().sqlite;
}
