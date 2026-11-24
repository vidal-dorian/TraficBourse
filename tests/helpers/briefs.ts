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

/** A brief to seed: its news items are given by title only, in rank order. */
export type SeedBrief = {
  date: string;
  kind: "daily" | "weekly";
  /** Defaults to "published". */
  status?: "published" | "draft";
  tldr: string;
  newsTitles: string[];
};

/** Summary, why-it-matters and source of every seeded news item: they must never come back from a read tool. */
export const SEEDED_NEWS_DETAILS = {
  summary: "Résumé détaillé qui ne doit jamais revenir dans la relecture des briefs.",
  whyItMatters: "Explication pédagogique qui ne doit jamais revenir dans la relecture des briefs.",
  impact: "Impact possible qui ne doit jamais revenir dans la relecture des briefs.",
  sourceName: "Source de test",
  sourceUrl: "https://example.com/source-ne-doit-pas-revenir",
} as const;

/**
 * Writes `seeds` into the database file, in the given order (so row ids follow that order):
 * published briefs through the app's own `publishBrief` (US #13), drafts with a plain insert, as
 * no tool writes a draft yet.
 *
 * Call it before the app opens the database (before the first MCP call), like
 * `failNewsItemInsertsTitled`: this connection is closed once the seeds are written.
 */
export async function seedBriefs(path: string, seeds: SeedBrief[]): Promise<void> {
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const { openDatabase } = await import("../../src/lib/db/client");
  const schema = await import("../../src/lib/db/schema");
  const { publishBrief } = await import("../../src/lib/briefs/publish");
  const { BriefPayload } = await import("../../src/lib/schemas/brief");

  const sqlite = openDatabase(path);
  try {
    const db = drizzle(sqlite, { schema });
    for (const seed of seeds) {
      const raw = {
        tldr: seed.tldr,
        mood: "mitige",
        news: seed.newsTitles.map((title) => ({ title, category: "macro", tickers: ["^FCHI"], ...SEEDED_NEWS_DETAILS })),
      };
      const payload = BriefPayload.parse(raw);
      if ((seed.status ?? "published") === "published") {
        publishBrief(db, { date: seed.date, kind: seed.kind, payload, rawPayload: JSON.stringify(raw) });
        continue;
      }
      const { id } = db
        .insert(schema.briefs)
        .values({ date: seed.date, kind: seed.kind, status: "draft", tldr: seed.tldr, mood: "mitige", rawPayload: JSON.stringify(raw) })
        .returning({ id: schema.briefs.id })
        .get();
      db.insert(schema.newsItems)
        .values(payload.news.map((news, index) => ({ briefId: id, rank: index + 1, ...news })))
        .run();
    }
  } finally {
    sqlite.close();
  }
}

export type StockNoteRow = {
  id: number;
  brief_id: number;
  symbol: string;
  reason: string;
  summary: string;
  news_refs: string;
  next_event: string | null;
};

/** Every stock note (US #26), grouped by brief, in insertion order. */
export function readStockNotes(path: string): StockNoteRow[] {
  return withDatabase(path, (db) => db.prepare("SELECT * FROM stock_notes ORDER BY brief_id, id").all() as StockNoteRow[]);
}

/**
 * Adds stocks to `instruments` and puts them in the watchlist (`in_watchlist` 1), or not when
 * `inWatchlist` is false. Call before the app opens the database.
 */
export async function seedStocks(
  path: string,
  stocks: { symbol: string; name: string; inWatchlist?: boolean; currency?: string }[],
): Promise<void> {
  const { openDatabase } = await import("../../src/lib/db/client");
  const sqlite = openDatabase(path);
  try {
    const insert = sqlite.prepare(
      "INSERT INTO instruments (symbol, provider_symbol, name, type, exchange, currency, in_watchlist) VALUES (?, ?, ?, 'stock', 'Paris', ?, ?)",
    );
    for (const stock of stocks) insert.run(stock.symbol, stock.symbol, stock.name, stock.currency ?? "EUR", (stock.inWatchlist ?? true) ? 1 : 0);
  } finally {
    sqlite.close();
  }
}
