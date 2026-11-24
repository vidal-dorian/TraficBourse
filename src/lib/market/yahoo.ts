// MarketDataProvider backed by yahoo-finance2 (unofficial Yahoo Finance API).
import YahooFinance from "yahoo-finance2";
import { parisToday, subtractDays } from "../dates/paris";
import type { DailyBar, MarketDataProvider } from "./provider";

/** The part of the yahoo-finance2 client this provider uses (so tests can inject a fake). */
export interface YahooChartClient {
  chart(
    symbol: string,
    options: { period1: string; period2: string; interval: "1d" },
  ): Promise<{
    meta?: { exchangeTimezoneName?: string; gmtoffset?: number };
    quotes: {
      date: Date;
      open: number | null;
      high: number | null;
      low: number | null;
      close: number | null;
      volume: number | null;
    }[];
  }>;
}

/** The part of the yahoo-finance2 client used to read the results dates (US #25). */
export interface YahooQuoteSummaryClient {
  quoteSummary(
    symbol: string,
    options: { modules: ("calendarEvents" | "earnings")[] },
  ): Promise<{
    calendarEvents?: { earnings?: { earningsDate?: Date[]; isEarningsDateEstimate?: boolean } };
    earnings?: { earningsChart?: { earningsDate?: Date[] } };
  }>;
}

function defaultClient(): YahooChartClient & YahooQuoteSummaryClient {
  return new YahooFinance({ suppressNotices: ["yahooSurvey"] });
}

/** The exchange's local calendar day of `instant`, "YYYY-MM-DD" (UTC when the zone is unknown). */
function localDay(instant: Date, timeZone: string | undefined, gmtOffsetSeconds: number | undefined): string {
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
        instant,
      );
    } catch {
      // Unknown zone name: fall through to the offset.
    }
  }
  return new Date(instant.getTime() + (gmtOffsetSeconds ?? 0) * 1000).toISOString().slice(0, 10);
}

export function createYahooProvider(client: YahooChartClient & Partial<YahooQuoteSummaryClient> = defaultClient()): MarketDataProvider {
  return {
    name: "yahoo-finance2",
    async getDailyBars(providerSymbol, from, to) {
      // Yahoo's period2 is exclusive: ask up to the day after `to`.
      const result = await client.chart(providerSymbol, {
        period1: from,
        period2: subtractDays(to, -1),
        interval: "1d",
      });
      const bars: DailyBar[] = [];
      for (const quote of result.quotes) {
        if (quote.close === null || quote.close === undefined) continue;
        bars.push({
          date: localDay(quote.date, result.meta?.exchangeTimezoneName, result.meta?.gmtoffset),
          open: quote.open ?? null,
          high: quote.high ?? null,
          low: quote.low ?? null,
          close: quote.close,
          volume: quote.volume ?? null,
        });
      }
      return bars;
    },
    async getLastEarningsDate(providerSymbol, asOf) {
      if (!client.quoteSummary) return null;
      const summary = await client.quoteSummary(providerSymbol, { modules: ["calendarEvents", "earnings"] });
      const calendar = summary.calendarEvents?.earnings;
      // An estimated date is a guessed range, not a publication: only confirmed calendar dates count.
      const instants = [
        ...(calendar?.isEarningsDateEstimate ? [] : (calendar?.earningsDate ?? [])),
        ...(summary.earnings?.earningsChart?.earningsDate ?? []),
      ];
      // The latest scheduled or confirmed date on or before `asOf`; upcoming dates are ignored. The 06:30
      // run on the earnings day therefore records it, and `get_watchlist` flags it the next session.
      // ISO dates sort as text.
      const days = instants.map((instant) => parisToday(instant)).filter((day) => day <= asOf);
      return days.length > 0 ? days.sort().at(-1)! : null;
    },
  };
}
