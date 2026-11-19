// US #7 — C36: the Drizzle migration creates the database in WAL mode at DATABASE_PATH.
//
// Contract:
// - `npm run db:migrate` applies the Drizzle migrations to the database at
//   `process.env.DATABASE_PATH`, creating the file if it does not exist.
// - The database is left in WAL journal mode (persistent: SQLite header bytes 18/19 = 2).
// - Drizzle records applied migrations in its `__drizzle_migrations` table.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers/project";
import { inspectDatabase, makeTempDir, readHeaderJournalVersions } from "./helpers/sqlite";

function runMigration(databasePath: string): void {
  try {
    execFileSync("npm", ["run", "db:migrate"], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_PATH: databasePath },
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: string; stderr?: string };
    throw new Error(`npm run db:migrate failed:\n${stdout ?? ""}\n${stderr ?? ""}`);
  }
}

describe("C36 — Drizzle migration creates the database in WAL mode", () => {
  it("C36 — given the repo and DATABASE_PATH pointing to a new file, when I run the Drizzle migration, then the database is created at that path in WAL mode", () => {
    const databasePath = join(makeTempDir(), "bourse.db");
    expect(existsSync(databasePath)).toBe(false);

    runMigration(databasePath);

    expect(existsSync(databasePath), `database expected at ${databasePath}`).toBe(true);
    expect(readHeaderJournalVersions(databasePath)).toEqual({ write: 2, read: 2 });
    const { journalMode, tables } = inspectDatabase(databasePath);
    expect(journalMode).toBe("wal");
    expect(tables).toContain("__drizzle_migrations");
  });
});
