// Prices job (CLAUDE.md §2): fetches the closing prices of every instrument through a
// MarketDataProvider and stores them in prices_daily. The app owns all the numbers.
import { eq, max } from "drizzle-orm";
import { parisToday } from "../lib/dates/paris";
import type { Db } from "../lib/db/client";
import { instruments, jobRuns, pricesDaily } from "../lib/db/schema";
import type { DailyBar, MarketDataProvider } from "../lib/market/provider";
import { storeFinishedBars } from "../lib/market/store-bars";

export interface JobLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface PricesJobResult {
  /** `source` is the name of the provider that served the bars. */
  updated: { symbol: string; bars: number; source: string }[];
  failed: { symbol: string; error: string }[];
}

export interface PricesJobOptions {
  db: Db;
  provider: MarketDataProvider;
  /** Asked, with the instrument's `fallbackSymbol`, only for the symbols `provider` failed on. */
  fallback?: MarketDataProvider;
  now?: Date;
  logger?: JobLogger;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Stores the last results date of a watchlist stock (US #25). A date overwrites, null keeps what is
 * stored; a failure is logged and never fails the stock's prices.
 */
async function refreshLastEarningsDate(
  db: Db,
  provider: MarketDataProvider,
  instrument: typeof instruments.$inferSelect,
  today: string,
  logger: JobLogger,
): Promise<void> {
  if (!provider.getLastEarningsDate || !instrument.inWatchlist || instrument.type !== "stock") return;
  try {
    const date = await provider.getLastEarningsDate(instrument.providerSymbol, today);
    if (date !== null) {
      db.update(instruments).set({ lastEarningsDate: date }).where(eq(instruments.symbol, instrument.symbol)).run();
    }
  } catch (error) {
    logger.error(`prices: ${instrument.symbol} earnings date failed: ${errorMessage(error)}`);
  }
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
 * is logged and reported, the others go on. When the primary provider fails on an instrument that has
 * a `fallbackSymbol`, the fallback provider is asked instead (US #19).
 */
export async function runPricesJob({
  db,
  provider,
  fallback,
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
      let fetched: DailyBar[];
      let source = provider.name;
      try {
        fetched = await provider.getDailyBars(instrument.providerSymbol, from, today);
      } catch (primaryError) {
        if (!fallback || !instrument.fallbackSymbol) throw primaryError;
        const primaryMessage = errorMessage(primaryError);
        logger.error(`prices: ${instrument.symbol} failed: ${primaryMessage}, trying ${fallback.name}`);
        try {
          fetched = await fallback.getDailyBars(instrument.fallbackSymbol, from, today);
        } catch (fallbackError) {
          throw new Error(`${primaryMessage}; ${fallback.name}: ${errorMessage(fallbackError)}`);
        }
        source = fallback.name;
      }
      const stored = storeFinishedBars(db, instrument.symbol, fetched, today);
      result.updated.push({ symbol: instrument.symbol, bars: stored, source });
      await refreshLastEarningsDate(db, provider, instrument, today, logger);
    } catch (error) {
      const message = errorMessage(error);
      result.failed.push({ symbol: instrument.symbol, error: message });
      logger.error(`prices: ${instrument.symbol} failed: ${message}`);
    }
  }

  db.insert(jobRuns).values({ at: now, updatedCount: result.updated.length, failed: result.failed }).run();

  const perSource = Map.groupBy(result.updated, (entry) => entry.source);
  const sources = [...perSource].map(([name, entries]) => `${name}: ${entries.length}`).join(", ");
  logger.info(
    `prices: ${result.updated.length} instrument(s) updated${sources ? ` (${sources})` : ""}, ${result.failed.length} failed`,
  );
  return result;
}
