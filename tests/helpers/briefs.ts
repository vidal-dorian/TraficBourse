// Test helpers for the `briefs` and `news_items` tables (US #13).
//
// The tables are read with Node's built-in SQLite driver, on their own connection, so the tests
// see what was really committed to the file, not what the app's connection holds.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export type BriefRow = {
  id: number;
  date: string;
  kind: string;
  status: string;
  tldr: string;
  mood: string;
  raw_payload: string;
  published_at: unknown;
};

export type NewsItemRow = {
  id: number;
  brief_id: number;
  rank: number;
  title: string;
  summary: string;
  why_it_matters: string;
  impact: string;
  category: string;
  tickers: string;
  source_name: string;
  source_url: string;
};

function withDatabase<T>(path: string, read: (db: InstanceType<typeof DatabaseSync>) => T, readOnly = true): T {
  const db = new DatabaseSync(path, { readOnly });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

/** Every brief, oldest row first. */
export function readBriefs(path: string): BriefRow[] {
  return withDatabase(path, (db) => db.prepare("SELECT * FROM briefs ORDER BY id").all() as BriefRow[]);
}

/** Every news item, grouped by brief then in rank order. */
export function readNewsItems(path: string): NewsItemRow[] {
  return withDatabase(path, (db) => db.prepare("SELECT * FROM news_items ORDER BY brief_id, rank").all() as NewsItemRow[]);
}

/** Number of rows in `briefs` and `news_items`. */
export function countBriefRows(path: string): { briefs: number; newsItems: number } {
  return withDatabase(path, (db) => {
    const briefs = db.prepare("SELECT COUNT(*) AS n FROM briefs").get() as { n: number };
    const newsItems = db.prepare("SELECT COUNT(*) AS n FROM news_items").get() as { n: number };
    return { briefs: Number(briefs.n), newsItems: Number(newsItems.n) };
  });
}

/** Message of the simulated write failure: it must never reach the client. */
export const SIMULATED_FAILURE = "simulated news_items write failure";

/**
 * Makes any insert into `news_items` whose title is `title` abort, from inside SQLite: a failure
 * in the middle of the write, with no hook in the production code.
 *
 * Call it before the app opens the database (before the first MCP call): this writable
 * connection comes from another SQLite library than the app's better-sqlite3, and closing it
 * while the app holds the file would drop the app's locks and reset the WAL under it.
 */
export function failNewsItemInsertsTitled(path: string, title: string): void {
  withDatabase(
    path,
    (db) => {
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'news_items'").get();
      if (!table) throw new Error("The committed migrations do not create the news_items table");
      db.exec(`
        CREATE TRIGGER fail_news_item_insert BEFORE INSERT ON news_items
        WHEN NEW.title = '${title.replaceAll("'", "''")}'
        BEGIN
          SELECT RAISE(ABORT, '${SIMULATED_FAILURE}');
        END;
      `);
    },
    false,
  );
}
