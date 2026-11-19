import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../helpers/sqlite";

describe("/api/health when the database is unavailable", () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  let databasePath: string;

  beforeEach(() => {
    // The parent "folder" is a regular file: the database can neither be created nor opened.
    const blocker = join(makeTempDir(), "not-a-folder");
    writeFileSync(blocker, "");
    databasePath = join(blocker, "bourse.db");
    process.env.DATABASE_PATH = databasePath;
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
  });

  it("answers 503 with db.status 'error', without leaking the path or the stack", async () => {
    const { GET } = await import("../../src/app/api/health/route");

    const response = GET(new Request("http://localhost/api/health"));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const raw = await response.text();
    expect(JSON.parse(raw)).toEqual({ status: "error", db: { status: "error" } });
    expect(raw).not.toContain(databasePath);
    expect(console.error).toHaveBeenCalled();
  });
});
