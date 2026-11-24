// Data of the /marches list (US #23): per instrument, the last close up to a day and its four
// variations, computed like `get_market_snapshot` (`computeVariations`).
import { and, eq, gte, lte, max, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { instruments, pricesDaily } from "../db/schema";
import { isStale } from "./latest";
import { computeVariations, referenceDate, type DatedClose, type Variations } from "./snapshot";

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
 * One entry per instrument, ordered by name (French collation), from the closes dated up to `today`; the
 * result equals `computeVariations` on the whole history. Queries: the instruments, the last close date of
 * every symbol, then per symbol with a close only what its references need: the closes from the last one on or
 * before the earlier of the year-to-date and 1 month references of its last close (as `loadCloses` of chart.ts).
 */
export function getMarketOverview(db: Db, today: string): MarketOverviewEntry[] {
  const lastDates = new Map(
    db
      .select({ symbol: pricesDaily.symbol, date: max(pricesDaily.date) })
      .from(pricesDaily)
      .where(lte(pricesDaily.date, today))
      .groupBy(pricesDaily.symbol)
      .all()
      .map((row) => [row.symbol, row.date]),
  );
  return (
    db
      .select()
      .from(instruments)
      .all()
      // Sorted here, not in SQL: SQLite compares bytes, so « iShares » would come after « S&P 500 ».
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))
      .map(({ symbol, name, type, currency }) => {
        const last = lastDates.get(symbol);
        let closes: DatedClose[] = [];
        if (last) {
          const reference = [referenceDate(last, "YTD"), referenceDate(last, "1M")].sort()[0];
          const baseDate = sql`coalesce((select max(${pricesDaily.date}) from ${pricesDaily} where ${pricesDaily.symbol} = ${symbol} and ${pricesDaily.date} <= ${reference}), ${reference})`;
          closes = db
            .select({ date: pricesDaily.date, close: pricesDaily.close })
            .from(pricesDaily)
            .where(and(eq(pricesDaily.symbol, symbol), gte(pricesDaily.date, baseDate), lte(pricesDaily.date, today)))
            .all();
        }
        const { lastClose, lastCloseDate, variations } = computeVariations(closes, today);
        return { symbol, name, type, currency, close: lastClose, date: lastCloseDate, stale: isStale(type, lastCloseDate, today), variations };
      })
  );
}
