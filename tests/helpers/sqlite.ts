import { mkdtempSync, openSync, readSync, closeSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Node's built-in SQLite driver, used only to inspect databases created by the app.
// Loaded through createRequire so that Vite does not try to resolve it.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

/** A fresh temporary directory, unique to the calling test. */
export function makeTempDir(prefix = "bourse-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Reads the SQLite file header: bytes 18 and 19 (file format write/read version)
 * are both 2 when the database is in WAL mode, 1 for the legacy rollback journal.
 */
export function readHeaderJournalVersions(path: string): { write: number; read: number } {
  const fd = openSync(path, "r");
  try {
    const header = Buffer.alloc(100);
    readSync(fd, header, 0, 100, 0);
    if (header.subarray(0, 16).toString("latin1") !== "SQLite format 3\u0000") {
      throw new Error(`${path} is not a SQLite database`);
    }
    return { write: header[18], read: header[19] };
  } finally {
    closeSync(fd);
  }
}

/** Opens the database read-only and returns `PRAGMA journal_mode` and the table names. */
export function inspectDatabase(path: string): { journalMode: string; tables: string[] } {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const mode = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((row) => row.name);
    return { journalMode: mode.journal_mode, tables };
  } finally {
    db.close();
  }
}
