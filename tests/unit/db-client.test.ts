import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_DATABASE_PATH, openDatabase, resolveDatabasePath } from "../../src/lib/db/client";
import { makeTempDir } from "../helpers/sqlite";

describe("resolveDatabasePath", () => {
  it("uses DATABASE_PATH, resolved to an absolute path", () => {
    expect(resolveDatabasePath({ DATABASE_PATH: "/srv/bourse/app.db" })).toBe("/srv/bourse/app.db");
    expect(resolveDatabasePath({ DATABASE_PATH: "tmp/app.db" })).toBe(resolve("tmp/app.db"));
  });

  it("falls back to the local default when DATABASE_PATH is unset or blank", () => {
    expect(resolveDatabasePath({})).toBe(resolve(DEFAULT_DATABASE_PATH));
    expect(resolveDatabasePath({ DATABASE_PATH: "   " })).toBe(resolve(DEFAULT_DATABASE_PATH));
  });
});

describe("openDatabase", () => {
  it("creates the file and its missing parent folders, in WAL mode with a busy timeout", () => {
    const path = join(makeTempDir(), "nested", "folder", "bourse.db");

    const sqlite = openDatabase(path);
    try {
      expect(existsSync(path)).toBe(true);
      expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(sqlite.pragma("busy_timeout", { simple: true })).toBeGreaterThan(0);
      expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});
