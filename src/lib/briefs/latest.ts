// The brief shown on the home page (« Aujourd'hui »): the latest published one, with its news.
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { briefs, newsItems } from "@/lib/db/schema";

export type LatestBrief = Pick<typeof briefs.$inferSelect, "date" | "kind" | "tldr" | "mood"> & {
  /** In rank order. */
  news: Omit<typeof newsItems.$inferSelect, "id" | "briefId">[];
};

/**
 * The published brief with the most recent date up to `today` ("YYYY-MM-DD") included, drafts
 * and future-dated briefs left out; on the same date the weekly recap wins over the daily brief,
 * as in `listRecentBriefs`. Undefined when there is none.
 */
export function getLatestBrief(db: Db, today: string): LatestBrief | undefined {
  const brief = db
    .select({ id: briefs.id, date: briefs.date, kind: briefs.kind, tldr: briefs.tldr, mood: briefs.mood })
    .from(briefs)
    .where(and(eq(briefs.status, "published"), lte(briefs.date, today)))
    .orderBy(desc(briefs.date), sql`CASE ${briefs.kind} WHEN 'weekly' THEN 0 ELSE 1 END`)
    .limit(1)
    .get();
  if (!brief) return undefined;

  const { id, ...rest } = brief;
  const news = db
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
    })
    .from(newsItems)
    .where(eq(newsItems.briefId, id))
    .orderBy(asc(newsItems.rank))
    .all();
  return { ...rest, news };
}
