// Publication of a brief (CLAUDE.md §7, principle 3): one atomic, idempotent write per date and
// kind. Republishing replaces that brief in a single transaction: no duplicate, no half-written
// state.
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { briefs, newsItems, stockNotes } from "@/lib/db/schema";
import type { BriefKind, BriefPayload } from "@/lib/schemas/brief";

export type PublishBriefInput = {
  date: string;
  kind: BriefKind;
  /** The validated payload. */
  payload: BriefPayload;
  /** The payload exactly as received (before defaults), as JSON text. */
  rawPayload: string;
  /** Publication time; defaults to now. */
  publishedAt?: Date;
};

export type PublishBriefResult = { briefId: number; newsCount: number };

/**
 * Writes the brief of (`date`, `kind`) as published with its news items, replacing the previous
 * one if any. The brief row is updated in place (same id, other tables will reference it) and its
 * news items are replaced, all in one transaction: if anything fails, nothing changes.
 */
export function publishBrief(db: Db, input: PublishBriefInput): PublishBriefResult {
  const { date, kind, payload, rawPayload, publishedAt = new Date() } = input;
  const content = { status: "published", tldr: payload.tldr, mood: payload.mood, rawPayload, publishedAt } as const;

  // Synchronous callback (better-sqlite3). Immediate: take the write lock up front rather than
  // upgrading a read lock, which could fail with SQLITE_BUSY against the jobs process.
  return db.transaction(
    (tx) => {
      const { id: briefId } = tx
        .insert(briefs)
        .values({ date, kind, ...content })
        .onConflictDoUpdate({ target: [briefs.date, briefs.kind], set: content })
        .returning({ id: briefs.id })
        .get();

      tx.delete(newsItems).where(eq(newsItems.briefId, briefId)).run();
      tx.insert(newsItems)
        .values(
          payload.news.map((news, index) => ({
            briefId,
            rank: index + 1,
            title: news.title,
            summary: news.summary,
            whyItMatters: news.whyItMatters,
            impact: news.impact,
            category: news.category,
            tickers: news.tickers,
            sourceName: news.sourceName,
            sourceUrl: news.sourceUrl,
            chartSpec: news.chart ?? null,
          })),
        )
        .run();

      tx.delete(stockNotes).where(eq(stockNotes.briefId, briefId)).run();
      // Tolerant of a payload that skipped the schema (no defaults applied): no key, no note.
      const notes = payload.stockNotes ?? [];
      if (notes.length > 0) {
        tx.insert(stockNotes)
          .values(
            notes.map((note) => ({
              briefId,
              symbol: note.symbol,
              reason: note.reason,
              summary: note.summary,
              newsRefs: note.newsRefs,
              nextEvent: note.nextEvent ?? null,
            })),
          )
          .run();
      }

      return { briefId, newsCount: payload.news.length };
    },
    { behavior: "immediate" },
  );
}
