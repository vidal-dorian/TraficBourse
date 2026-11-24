// The brief shown on the home page (« Aujourd'hui »): the latest published one, with its news.
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { briefs, newsItems } from "@/lib/db/schema";
import { loadChartData, type ChartData } from "@/lib/market/chart";

/** On the same date, the weekly recap before the daily brief (`ORDER BY` fragment). */
export const weeklyFirst = sql`CASE ${briefs.kind} WHEN 'weekly' THEN 0 ELSE 1 END`;

/** The columns of a shown brief, its id to load its news. */
export const briefColumns = { id: briefs.id, date: briefs.date, kind: briefs.kind, tldr: briefs.tldr, mood: briefs.mood };

/** A brief as the public pages show it (home page, brief of a date). */
export type BriefWithNews = Pick<typeof briefs.$inferSelect, "date" | "kind" | "tldr" | "mood"> & {
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
  return { ...rest, news: newsOf(db, id, brief.date) };
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
