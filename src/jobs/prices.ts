// Prices job (CLAUDE.md §2): fetches the closing prices of every instrument through a
// MarketDataProvider and stores them in prices_daily. The app owns all the numbers.
import { eq, max, sql } from "drizzle-orm";
import { parisToday } from "../lib/dates/paris";
import type { Db } from "../lib/db/client";
import { instruments, pricesDaily } from "../lib/db/schema";
import type { MarketDataProvider } from "../lib/market/provider";

export interface JobLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface PricesJobResult {
  updated: { symbol: string; bars: number }[];
  failed: { symbol: string; error: string }[];
}

export interface PricesJobOptions {
  db: Db;
  provider: MarketDataProvider;
  now?: Date;
  logger?: JobLogger;
}

/** `date` ("YYYY-MM-DD") one calendar year earlier (29 February becomes 28 February). */
function oneYearBefore(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year - 1, month - 1, day));
  if (target.getUTCMonth() !== month - 1) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

/**
 * Without history an instrument gets one year (Paris today minus 1 year); otherwise the fetch
 * restarts from its last stored day, inclusive, so a revised close is corrected. Rows are
 * upserted on (symbol, date): running twice the same day leaves no duplicate. A failing symbol
 * is logged and reported, the others go on.
 */
export async function runPricesJob({
  db,
  provider,
  now = new Date(),
  logger = console,
}: PricesJobOptions): Promise<PricesJobResult> {
  const today = parisToday(now);
  const result: PricesJobResult = { updated: [], failed: [] };
  const all = db.select().from(instruments).all();

  for (const instrument of all) {
    try {
      const last = db
        .select({ date: max(pricesDaily.date) })
        .from(pricesDaily)
        .where(eq(pricesDaily.symbol, instrument.symbol))
        .get()?.date;
      const from = last ?? oneYearBefore(today);
      const fetched = await provider.getDailyBars(instrument.providerSymbol, from, today);
      // A bar dated Paris today is a day still trading (24/7 markets, futures, FX at 06:30):
      // its "close" is a live price that would be stored as final. Only finished days are kept.
      const bars = fetched.filter((bar) => bar.date < today);
      db.transaction((tx) => {
        for (const bar of bars) {
          const row = { symbol: instrument.symbol, ...bar };
          tx.insert(pricesDaily)
            .values(row)
            .onConflictDoUpdate({
              target: [pricesDaily.symbol, pricesDaily.date],
              set: { open: sql`excluded.open`, high: sql`excluded.high`, low: sql`excluded.low`, close: sql`excluded.close`, volume: sql`excluded.volume` },
            })
            .run();
        }
      });
      result.updated.push({ symbol: instrument.symbol, bars: bars.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed.push({ symbol: instrument.symbol, error: message });
      logger.error(`prices: ${instrument.symbol} failed: ${message}`);
    }
  }

  logger.info(
    `prices: ${result.updated.length} instrument(s) updated, ${result.failed.length} failed (${provider.name})`,
  );
  return result;
}
