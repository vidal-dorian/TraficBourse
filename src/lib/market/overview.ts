// Data of the /marches list (US #23): per instrument, the last close up to a day and its four
// variations, computed like `get_market_snapshot` (`computeVariations`).
import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import { instruments, pricesDaily } from "../db/schema";
import { isStale } from "./latest";
import { computeVariations, type DatedClose, type Variations } from "./snapshot";

export interface MarketOverviewEntry {
  symbol: string;
  name: string;
  type: string;
  currency: string;
  close: number | null;
  /** Day of `close`, "YYYY-MM-DD"; null without any close up to the day. */
  date: string | null;
  stale: boolean;
  variations: Variations;
}

/**
 * One entry per instrument, ordered by name (French collation), from the closes dated up to `today`.
 * Two queries for every instrument: the instruments, then the closes since 1 December of the previous year
 * (enough for the day, week, month and year-to-date references of a close from this year). An instrument
 * without close in that window costs one more query for its last close, so a long-stale price still shows.
 */
export function getMarketOverview(db: Db, today: string): MarketOverviewEntry[] {
  const since = `${Number(today.slice(0, 4)) - 1}-12-01`;
  const closesBySymbol = new Map<string, DatedClose[]>();
  for (const row of db
    .select({ symbol: pricesDaily.symbol, date: pricesDaily.date, close: pricesDaily.close })
    .from(pricesDaily)
    .where(and(gte(pricesDaily.date, since), lte(pricesDaily.date, today)))
    .all()) {
    const closes = closesBySymbol.get(row.symbol) ?? [];
    closes.push({ date: row.date, close: row.close });
    closesBySymbol.set(row.symbol, closes);
  }
  return (
    db
      .select()
      .from(instruments)
      .all()
      // Sorted here, not in SQL: SQLite compares bytes, so « iShares » would come after « S&P 500 ».
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))
      .map(({ symbol, name, type, currency }) => {
        const closes =
          closesBySymbol.get(symbol) ??
          db
            .select({ date: pricesDaily.date, close: pricesDaily.close })
            .from(pricesDaily)
            .where(and(eq(pricesDaily.symbol, symbol), lte(pricesDaily.date, today)))
            .orderBy(desc(pricesDaily.date))
            .limit(1)
            .all();
        const { lastClose, lastCloseDate, variations } = computeVariations(closes, today);
        return { symbol, name, type, currency, close: lastClose, date: lastCloseDate, stale: isStale(type, lastCloseDate, today), variations };
      })
  );
}
