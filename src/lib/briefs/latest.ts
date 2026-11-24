// The brief shown on the home page (« Aujourd'hui »): the latest published one, with its news.
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { briefs, instruments, newsItems, stockNotes } from "@/lib/db/schema";
import { loadChartData, type ChartData } from "@/lib/market/chart";
import { computeVariations } from "@/lib/market/snapshot";

/** On the same date, the weekly recap before the daily brief (`ORDER BY` fragment). */
export const weeklyFirst = sql`CASE ${briefs.kind} WHEN 'weekly' THEN 0 ELSE 1 END`;

/** The columns of a shown brief, its id to load its news. */
export const briefColumns = { id: briefs.id, date: briefs.date, kind: briefs.kind, tldr: briefs.tldr, mood: briefs.mood };

/** A note of the « Ma watchlist » section: Claude's text and the app's day variation of the stock. */
export type StockNoteCard = Pick<typeof stockNotes.$inferSelect, "symbol" | "reason" | "summary" | "newsRefs" | "nextEvent"> & {
  /** The instrument's name, the symbol when it is not an instrument any more. */
  name: string;
  /** Day variation in percent from the closes before the brief date, null when unknown. */
  dayVariation: number | null;
};

/** A brief as the public pages show it (home page, brief of a date). */
export type BriefWithNews = Pick<typeof briefs.$inferSelect, "date" | "kind" | "tldr" | "mood"> & {
  /** In payload order, empty when the brief has no note. */
  stockNotes: StockNoteCard[];
  /** In rank order. */
  news: (Omit<typeof newsItems.$inferSelect, "id" | "briefId" | "chartSpec"> & {
    /** The series of the news item's chart, from `prices_daily`; null without chart. */
    chart: ChartData | null;
  })[];
};

/**
 * The published brief with the most recent date up to `today` ("YYYY-MM-DD") included, drafts
 * and future-dated briefs left out; on the same date the weekly recap wins over the daily brief,
 * as in `listRecentBriefs`. Undefined when there is none.
 */
export function getLatestBrief(db: Db, today: string): BriefWithNews | undefined {
  const brief = db
    .select(briefColumns)
    .from(briefs)
    .where(and(eq(briefs.status, "published"), lte(briefs.date, today)))
    .orderBy(desc(briefs.date), weeklyFirst)
    .limit(1)
    .get();
  if (!brief) return undefined;

  const { id, ...rest } = brief;
  return { ...rest, news: newsOf(db, id, brief.date), stockNotes: stockNotesOf(db, id, brief.date) };
}

/** The news items of the brief `briefId` dated `date`, in rank order, with the series of their chart ending on `date`. */
export function newsOf(db: Db, briefId: number, date: string): BriefWithNews["news"] {
  const rows = db
    .select({
      rank: newsItems.rank,
      title: newsItems.title,
      summary: newsItems.summary,
      whyItMatters: newsItems.whyItMatters,
      impact: newsItems.impact,
      category: newsItems.category,
      tickers: newsItems.tickers,
      sourceName: newsItems.sourceName,
      sourceUrl: newsItems.sourceUrl,
      chartSpec: newsItems.chartSpec,
    })
    .from(newsItems)
    .where(eq(newsItems.briefId, briefId))
    .orderBy(asc(newsItems.rank))
    .all();
  return rows.map(({ chartSpec, ...item }) => ({ ...item, chart: chartSpec ? loadChartData(db, chartSpec, date) : null }));
}

/**
 * The stock notes of the brief `briefId` dated `date`, in payload order. Day variations come from
 * the closes strictly before `date`, as for the market tiles. Three queries whatever the number of
 * notes: the notes, their instruments, then the last two closes of each symbol.
 */
export function stockNotesOf(db: Db, briefId: number, date: string): StockNoteCard[] {
  const notes = db
    .select({
      symbol: stockNotes.symbol,
      reason: stockNotes.reason,
      summary: stockNotes.summary,
      newsRefs: stockNotes.newsRefs,
      nextEvent: stockNotes.nextEvent,
    })
    .from(stockNotes)
    .where(eq(stockNotes.briefId, briefId))
    .orderBy(asc(stockNotes.id))
    .all();
  if (notes.length === 0) return [];

  const symbols = [...new Set(notes.map((note) => note.symbol))];
  const names = new Map(
    db
      .select({ symbol: instruments.symbol, name: instruments.name })
      .from(instruments)
      .where(inArray(instruments.symbol, symbols))
      .all()
      .map((row) => [row.symbol, row.name]),
  );
  const lastTwo = db.all<{ symbol: string; date: string; close: number }>(sql`
    SELECT symbol, date, close FROM (
      SELECT symbol, date, close, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS position
      FROM prices_daily
      WHERE symbol IN (${sql.join(symbols.map((symbol) => sql`${symbol}`), sql`, `)}) AND date < ${date}
    ) WHERE position <= 2`);

  return notes.map((note) => ({
    ...note,
    name: names.get(note.symbol) ?? note.symbol,
    dayVariation: computeVariations(
      lastTwo.filter((row) => row.symbol === note.symbol),
      date,
    ).variations.day,
  }));
}
