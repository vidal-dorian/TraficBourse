// Shared helpers of the prices job tests (US #18): a migrated DB and a fake provider.
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { openDatabase } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { makeMigratedDatabase } from "./mcp";

export interface Bar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

export const DEFAULT_SYMBOLS = [
  "^FCHI",
  "^STOXX50E",
  "^GSPC",
  "^NDX",
  "IWDA.AS",
  "EURUSD=X",
  "GC=F",
  "BZ=F",
  "BTC-EUR",
];

export function openMigrated(): { sqlite: Database.Database; db: ReturnType<typeof drizzle<typeof schema>> } {
  const sqlite = openDatabase(makeMigratedDatabase());
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export function bar(date: string, close: number): Bar {
  return { date, open: close - 1, high: close + 1, low: close - 2, close, volume: 1000 };
}

export interface Call {
  providerSymbol: string;
  from: string;
  to: string;
}

/** A provider returning `bars[symbol]`, recording every call; a symbol in `failing` throws. */
export function fakeProvider(bars: Record<string, Bar[]>, failing: string[] = []) {
  const calls: Call[] = [];
  return {
    calls,
    setBars(symbol: string, list: Bar[]) {
      bars[symbol] = list;
    },
    name: "fake",
    async getDailyBars(providerSymbol: string, from: string, to: string): Promise<Bar[]> {
      calls.push({ providerSymbol, from, to });
      if (failing.includes(providerSymbol)) throw new Error(`boom ${providerSymbol}`);
      return (bars[providerSymbol] ?? []).filter((b) => b.date >= from && b.date <= to);
    },
  };
}

export function fakeLogger() {
  const infos: string[] = [];
  const errors: string[] = [];
  return { infos, errors, info: (m: string) => void infos.push(m), error: (m: string) => void errors.push(m) };
}

export function priceRows(sqlite: Database.Database, symbol?: string) {
  const sql = "SELECT symbol, date, close FROM prices_daily" + (symbol ? " WHERE symbol = ?" : "") + " ORDER BY symbol, date";
  return (symbol ? sqlite.prepare(sql).all(symbol) : sqlite.prepare(sql).all()) as {
    symbol: string;
    date: string;
    close: number;
  }[];
}
