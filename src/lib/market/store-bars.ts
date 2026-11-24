// Storing rules of the daily bars, shared by the prices job and the watchlist add (US #24).
import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { pricesDaily } from "../db/schema";
import type { DailyBar } from "./provider";

/**
 * Upserts, in one transaction, the bars of `symbol` dated before `today` (Paris, "YYYY-MM-DD") and
 * returns how many were written. A bar dated Paris today is a day still trading (24/7 markets,
 * futures, FX at 06:30): its "close" is a live price that would be stored as final, so only
 * finished days are kept. Rows are upserted on (symbol, date): a revised close is corrected.
 */
export function storeFinishedBars(db: Db, symbol: string, fetched: DailyBar[], today: string): number {
  const bars = fetched.filter((bar) => bar.date < today);
  db.transaction((tx) => {
    for (const bar of bars) {
      tx.insert(pricesDaily)
        .values({ symbol, ...bar })
        .onConflictDoUpdate({
          target: [pricesDaily.symbol, pricesDaily.date],
          set: { open: sql`excluded.open`, high: sql`excluded.high`, low: sql`excluded.low`, close: sql`excluded.close`, volume: sql`excluded.volume` },
        })
        .run();
    }
  });
  return bars.length;
}
