// Rereading of the latest published briefs (CLAUDE.md §7, `get_recent_briefs`): only what the
// Claude scheduled task needs to avoid repeating itself, the TL;DR and the news titles.
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { weeklyFirst } from "@/lib/briefs/latest";
import type { Db } from "@/lib/db/client";
import { briefs, newsItems } from "@/lib/db/schema";
import type { BriefKind } from "@/lib/schemas/brief";

export type RecentBrief = {
  date: string;
  kind: BriefKind;
  tldr: string;
  /** Titles of the brief's news items, in rank order. */
  newsTitles: string[];
};

/** Inclusive window of brief dates, both "YYYY-MM-DD". */
export type RecentBriefsWindow = { since: string; until: string };

/**
 * The published briefs dated from `since` to `until` included, drafts left out. The upper bound
 * matters: publish_brief accepts any calendar date, so without it future-dated briefs would come
 * back on every call, whatever the window. Most recent date first; on the same date the weekly
 * recap comes before the daily brief. Two queries whatever the number of briefs: the briefs,
 * then all their news titles.
 */
export function listRecentBriefs(db: Db, { since, until }: RecentBriefsWindow): RecentBrief[] {
  const rows = db
    .select({ id: briefs.id, date: briefs.date, kind: briefs.kind, tldr: briefs.tldr })
    .from(briefs)
    .where(and(eq(briefs.status, "published"), gte(briefs.date, since), lte(briefs.date, until)))
    .orderBy(desc(briefs.date), weeklyFirst)
    .all();
  if (rows.length === 0) return [];

  const titlesByBrief = new Map<number, string[]>(rows.map((row) => [row.id, []]));
  const news = db
    .select({ briefId: newsItems.briefId, title: newsItems.title })
    .from(newsItems)
    .where(
      inArray(
        newsItems.briefId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(newsItems.briefId), asc(newsItems.rank))
    .all();
  for (const { briefId, title } of news) titlesByBrief.get(briefId)?.push(title);

  return rows.map(({ id, date, kind, tldr }) => ({ date, kind, tldr, newsTitles: titlesByBrief.get(id) ?? [] }));
}
