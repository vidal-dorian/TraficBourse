// Past briefs (US #16): the list of the archives page and the briefs of a given date. Same rule as
// the home page: `published` briefs dated up to today in Paris, drafts and future dates left out.
import { and, desc, eq, lte } from "drizzle-orm";
import { briefColumns, newsOf, stockNotesOf, weeklyFirst, type BriefWithNews } from "@/lib/briefs/latest";
import type { Db } from "@/lib/db/client";
import { briefs } from "@/lib/db/schema";

export type ArchivedBrief = Pick<typeof briefs.$inferSelect, "date" | "kind">;

/**
 * Every published brief dated up to `today` ("YYYY-MM-DD") included, most recent date first; on
 * the same date the weekly recap comes before the daily brief.
 */
export function listArchivedBriefs(db: Db, today: string): ArchivedBrief[] {
  return db
    .select({ date: briefs.date, kind: briefs.kind })
    .from(briefs)
    .where(and(eq(briefs.status, "published"), lte(briefs.date, today)))
    .orderBy(desc(briefs.date), weeklyFirst)
    .all();
}

/**
 * The published briefs of `date` (one per kind at most) with their news, the weekly recap first;
 * none when `date` is after `today` ("YYYY-MM-DD" both).
 */
export function getBriefsOfDate(db: Db, date: string, today: string): BriefWithNews[] {
  return db
    .select(briefColumns)
    .from(briefs)
    .where(and(eq(briefs.status, "published"), eq(briefs.date, date), lte(briefs.date, today)))
    .orderBy(weeklyFirst)
    .all()
    .map(({ id, ...brief }) => ({ ...brief, news: newsOf(db, id, brief.date), stockNotes: stockNotesOf(db, id, brief.date) }));
}
