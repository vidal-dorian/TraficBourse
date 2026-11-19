// US #8 — design guidance (reviewer remark on PR #33): in the container the migration runner
// does not run from the repo root, so it must find the migrations folder relative to itself.
//
// Contract:
// - `src/lib/db/migrate.ts`, run from any working directory, applies the committed
//   migrations to the database at DATABASE_PATH (here: creates the `app_meta` table).
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rootPath } from "./helpers/project";
import { inspectDatabase, makeTempDir } from "./helpers/sqlite";

describe("US #8 notes — migration runner independent of the working directory", () => {
  it("given the migration runner started outside the repo root, when it runs, then it still finds and applies the migrations", () => {
    const elsewhere = makeTempDir("bourse-cwd-");
    const databasePath = join(makeTempDir(), "bourse.db");

    try {
      execFileSync(rootPath("node_modules", ".bin", "tsx"), [rootPath("src", "lib", "db", "migrate.ts")], {
        cwd: elsewhere,
        env: { ...process.env, DATABASE_PATH: databasePath },
        stdio: "pipe",
        encoding: "utf8",
      });
    } catch (error) {
      const { stdout, stderr } = error as { stdout?: string; stderr?: string };
      throw new Error(`migration runner failed from ${elsewhere}:\n${stdout ?? ""}\n${stderr ?? ""}`);
    }

    const { tables } = inspectDatabase(databasePath);
    expect(tables).toContain("__drizzle_migrations");
    expect(tables).toContain("app_meta");
  });
});
