// Last known close of every instrument (US #19): what a page shows when a symbol has no close for the day.
import { asc, desc, eq } from "drizzle-orm";
import { parisToday, subtractDays } from "../dates/paris";
import type { Db } from "../db/client";
import { instruments, pricesDaily } from "../db/schema";

export interface LatestClose {
  symbol: string;
  name: string;
  type: string;
  currency: string;
  close: number | null;
  /** Day of `close`, "YYYY-MM-DD"; null when the instrument has no price at all. */
  date: string | null;
  /** True when `date` is earlier than the close expected at `now` (never for an instrument without price). */
  stale: boolean;
}

/**
 * The close of the last finished session before Paris today: the day before for crypto (24/7), the
 * previous weekday for everything else (Monday, Saturday and Sunday expect Friday). Bank holidays
 * are not modelled: an instrument closed that day is reported stale, which only shows its date.
 */
function expectedCloseDate(type: string, today: string): string {
  const yesterday = subtractDays(today, 1);
  if (type === "crypto") return yesterday;
  // Day of the week of a calendar date, read at UTC midnight (0 = Sunday).
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (weekday === 0) return subtractDays(today, 2);
  if (weekday === 1) return subtractDays(today, 3);
  return yesterday;
}

/** One entry per instrument, ordered by name, with the latest row of `prices_daily` of its symbol. */
export function getLatestCloses(db: Db, now: Date = new Date()): LatestClose[] {
  const today = parisToday(now);
  return db
    .select()
    .from(instruments)
    .orderBy(asc(instruments.name))
    .all()
    .map((instrument) => {
      const last = db
        .select({ date: pricesDaily.date, close: pricesDaily.close })
        .from(pricesDaily)
        .where(eq(pricesDaily.symbol, instrument.symbol))
        .orderBy(desc(pricesDaily.date))
        .limit(1)
        .get();
      const date = last?.date ?? null;
      return {
        symbol: instrument.symbol,
        name: instrument.name,
        type: instrument.type,
        currency: instrument.currency,
        close: last?.close ?? null,
        date,
        stale: date !== null && date < expectedCloseDate(instrument.type, today),
      };
    });
}
