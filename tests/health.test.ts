// US #7 — C34: `/api/health` answers 200 with the state of the SQLite database.
//
// Contract:
// - `src/app/api/health/route.ts` exports `GET(request)` (App Router route handler).
// - The database file is the one at `process.env.DATABASE_PATH`.
// - Healthy response: HTTP 200, JSON
//     { "status": "ok", "db": { "status": "ok", "journalMode": "wal" } }
//   (extra fields are allowed; the filesystem path is not required to be exposed).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTempDir } from "./helpers/sqlite";

describe("C34 — /api/health reports the SQLite state", () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  let databasePath: string;

  beforeEach(() => {
    databasePath = join(makeTempDir(), "bourse.db");
    process.env.DATABASE_PATH = databasePath;
    // The DB client may read DATABASE_PATH at import time: load a fresh module graph.
    vi.resetModules();
  });

  afterEach(() => {
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
  });

  it("C34 — given the app started with DATABASE_PATH set, when I call GET /api/health, then I get 200 with the SQLite database state", async () => {
    const { GET } = await import("../src/app/api/health/route");

    const response: Response = await GET(new Request("http://localhost/api/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    const body = await response.json();
    expect(body).toMatchObject({
      status: "ok",
      db: { status: "ok", journalMode: "wal" },
    });
    // The state reported is the one of the database at DATABASE_PATH.
    expect(existsSync(databasePath)).toBe(true);
  });
});
