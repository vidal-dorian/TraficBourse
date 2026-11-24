// Tells whether the brief expected today has not arrived (CLAUDE.md §2): computed at request time.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { briefs } from "@/lib/db/schema";
import { parisToday, parisWeekdayAndHour } from "@/lib/dates/paris";

export type MissingBrief = "daily" | "weekly";

/** The banner text of each missing brief. */
export const MISSING_BRIEF_MESSAGES: Record<MissingBrief, string> = {
  daily: "Le brief du jour n'est pas encore arrivé",
  weekly: "Le récap de la semaine n'est pas encore arrivé",
};

const SATURDAY = 6;
const DAILY_DEADLINE_HOUR = 8;
const WEEKLY_DEADLINE_HOUR = 10;

/**
 * The brief expected at `now` (Paris time) and not published yet: the daily brief from 08:00 Monday
 * to Friday, the weekly recap from 10:00 on Saturday; null before, on Sunday, or when it is there.
 * `published` says which kinds have a published brief dated Paris today.
 */
export function missingBriefAt(now: Date, published: { daily: boolean; weekly: boolean }): MissingBrief | null {
  const { weekday, hour } = parisWeekdayAndHour(now);
  if (weekday >= 1 && weekday <= 5) return hour >= DAILY_DEADLINE_HOUR && !published.daily ? "daily" : null;
  if (weekday === SATURDAY) return hour >= WEEKLY_DEADLINE_HOUR && !published.weekly ? "weekly" : null;
  return null;
}

/** `missingBriefAt` fed by the published briefs dated Paris today (one query; a draft does not count). */
export function expectedBriefMissing(db: Db, now: Date): MissingBrief | null {
  const kinds = db
    .select({ kind: briefs.kind })
    .from(briefs)
    .where(and(eq(briefs.status, "published"), eq(briefs.date, parisToday(now))))
    .all()
    .map((row) => row.kind);
  return missingBriefAt(now, { daily: kinds.includes("daily"), weekly: kinds.includes("weekly") });
}
