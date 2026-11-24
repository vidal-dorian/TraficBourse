// MarketDataProvider backed by the Twelve Data REST API (fallback of Yahoo, US #19). The free tier
// allows 8 calls a minute, so request starts are spaced; it covers US stocks and ETFs, forex and crypto.
import { subtractDays } from "../dates/paris";
import type { DailyBar, MarketDataProvider } from "./provider";

const ENDPOINT = "https://api.twelvedata.com/time_series";

export interface TwelveDataOptions {
  apiKey: string;
  /** Injected for tests, the global `fetch` by default. */
  fetch?: typeof fetch;
  /** Waits `ms` milliseconds (injected for tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Clock in milliseconds (injected for tests). */
  now?: () => number;
  /** Minimum delay between two request starts: 8000 ms = 7.5 calls a minute, under the free tier's 8. */
  minIntervalMs?: number;
}

/** A finite number from a string, null when missing or not numeric. */
function parseNumber(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface TimeSeriesBody {
  status?: string;
  code?: number;
  message?: string;
  values?: { datetime?: string; open?: unknown; high?: unknown; low?: unknown; close?: unknown; volume?: unknown }[];
}

export function createTwelveDataProvider({
  apiKey,
  fetch: fetchFn = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  minIntervalMs = 8000,
}: TwelveDataOptions): MarketDataProvider {
  let lastStart: number | null = null;

  // Errors never carry the response message nor the underlying error text: either may echo the URL, key included.
  async function request(url: URL): Promise<TimeSeriesBody> {
    let response: Response;
    try {
      response = await fetchFn(url);
    } catch {
      throw new Error("Twelve Data request failed (network error)");
    }
    if (!response.ok) throw new Error(`Twelve Data request failed (HTTP ${response.status})`);
    try {
      return (await response.json()) as TimeSeriesBody;
    } catch {
      throw new Error("Twelve Data answered with an unreadable body");
    }
  }

  return {
    name: "twelvedata",
    async getDailyBars(providerSymbol, from, to) {
      if (lastStart !== null) {
        const wait = lastStart + minIntervalMs - now();
        if (wait > 0) await sleep(wait);
      }
      lastStart = now();

      const url = new URL(ENDPOINT);
      url.search = new URLSearchParams({
        symbol: providerSymbol,
        interval: "1day",
        start_date: from,
        // Treated as exclusive to be safe: ask up to the day after `to`.
        end_date: subtractDays(to, -1),
        apikey: apiKey,
        outputsize: "5000",
        timezone: "Exchange",
      }).toString();

      const body = await request(url);
      if (body.status === "error") {
        const code = body.code === undefined ? "" : ` ${body.code}`;
        throw new Error(`Twelve Data error${code} for ${providerSymbol}`);
      }

      const bars: DailyBar[] = [];
      for (const value of body.values ?? []) {
        const date = value.datetime?.slice(0, 10);
        const close = parseNumber(value.close);
        if (!date || close === null || date < from || date > to) continue;
        bars.push({
          date,
          open: parseNumber(value.open),
          high: parseNumber(value.high),
          low: parseNumber(value.low),
          close,
          volume: parseNumber(value.volume),
        });
      }
      return bars.sort((a, b) => a.date.localeCompare(b.date));
    },
  };
}
