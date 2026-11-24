// The watchlist (US #24): the instruments flagged `in_watchlist`. Nothing is ever deleted:
// removing a stock only clears the flag, its instrument row and price history stay.
import { asc, eq } from "drizzle-orm";
import { parisToday, subtractMonths } from "../dates/paris";
import type { Db } from "../db/client";
import { instruments } from "../db/schema";
import type { MarketDataProvider } from "../market/provider";
import type { InstrumentSearchResult } from "../market/search";
import { storeFinishedBars } from "../market/store-bars";

export interface WatchlistEntry {
  symbol: string;
  name: string;
  exchange: string | null;
}

/**
 * Follows `result`: creates the instrument (an existing one keeps its data, only the flag is set),
 * then fetches one year of history (Paris today minus 1 year) with the storing rules of the prices
 * job. If the provider fails the add rejects, but the stock stays followed: the prices job fills it.
 */
export async function addToWatchlist(
  db: Db,
  { result, provider, now = new Date() }: { result: InstrumentSearchResult; provider: MarketDataProvider; now?: Date },
): Promise<{ symbol: string; stored: number }> {
  const symbol = result.providerSymbol;
  db.insert(instruments)
    .values({
      symbol,
      providerSymbol: symbol,
      name: result.name,
      type: result.type,
      exchange: result.exchange,
      currency: result.currency,
      inWatchlist: true,
    })
    .onConflictDoUpdate({ target: instruments.symbol, set: { inWatchlist: true } })
    .run();

  const today = parisToday(now);
  const bars = await provider.getDailyBars(symbol, subtractMonths(today, 12), today);
  return { symbol, stored: storeFinishedBars(db, symbol, bars, today) };
}

/** Stops following `symbol`, deleting nothing. False when the symbol is unknown. */
export function removeFromWatchlist(db: Db, symbol: string): boolean {
  const updated = db.update(instruments).set({ inWatchlist: false }).where(eq(instruments.symbol, symbol)).returning({ symbol: instruments.symbol }).all();
  return updated.length > 0;
}

/** The followed instruments, by name (French collation). */
export function listWatchlist(db: Db): WatchlistEntry[] {
  return db
    .select({ symbol: instruments.symbol, name: instruments.name, exchange: instruments.exchange })
    .from(instruments)
    .where(eq(instruments.inWatchlist, true))
    .orderBy(asc(instruments.symbol))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}
