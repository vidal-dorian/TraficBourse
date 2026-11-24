// getMarketOverview (US #23) gives, per instrument, what computeVariations gives on the whole history.
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/lib/db/client";
import { getMarketOverview } from "../../src/lib/market/overview";
import { computeVariations } from "../../src/lib/market/snapshot";
import { makeMigratedDatabase } from "../helpers/mcp";

type Close = [string, number];

function overviewOf(today: string, history: Record<string, Close[]>) {
  const sqlite = openDatabase(makeMigratedDatabase());
  try {
    for (const [symbol, closes] of Object.entries(history)) {
      for (const [date, close] of closes) sqlite.prepare("INSERT INTO prices_daily (symbol, date, close) VALUES (?, ?, ?)").run(symbol, date, close);
    }
    return getMarketOverview(drizzle(sqlite), today);
  } finally {
    sqlite.close();
  }
}

function expectSameAsFullHistory(today: string, history: Record<string, Close[]>) {
  const entries = overviewOf(today, history);
  for (const [symbol, closes] of Object.entries(history)) {
    const expected = computeVariations(closes.map(([date, close]) => ({ date, close })), today);
    const entry = entries.find((e) => e.symbol === symbol);
    expect(entry?.close).toBe(expected.lastClose);
    expect(entry?.date).toBe(expected.lastCloseDate);
    expect(entry?.variations).toEqual(expected.variations);
  }
  return entries;
}

describe("getMarketOverview", () => {
  it("matches computeVariations in a normal case and ignores later closes", () => {
    const entries = expectSameAsFullHistory("2026-11-23", {
      "^FCHI": [["2025-12-31", 7000], ["2026-10-20", 7500], ["2026-11-13", 7800], ["2026-11-19", 8000], ["2026-11-20", 8100], ["2026-11-24", 9999]],
    });
    expect(entries.find((e) => e.symbol === "^FCHI")?.variations).toEqual({ day: 1.25, week: 3.85, month: 8, ytd: 15.71 });
  });

  it("matches computeVariations in early January, when the references reach back before December", () => {
    const entries = expectSameAsFullHistory("2026-01-02", {
      "^FCHI": [["2024-12-31", 7000], ["2025-11-28", 7400], ["2025-12-24", 7700], ["2025-12-30", 7900], ["2025-12-31", 8000]],
    });
    expect(entries.find((e) => e.symbol === "^FCHI")?.variations.ytd).not.toBeNull();
  });

  it("matches computeVariations for an instrument whose last close is old", () => {
    const entries = expectSameAsFullHistory("2026-01-02", { "^GSPC": [["2025-10-01", 5000], ["2025-10-31", 5100]] });
    expect(entries.find((e) => e.symbol === "^GSPC")?.variations.day).toBe(2);
  });

  it("matches computeVariations when the last close is in January and the month reference is the earlier one", () => {
    const entries = expectSameAsFullHistory("2026-01-05", {
      "^FCHI": [["2025-12-01", 100], ["2025-12-02", 110], ["2025-12-31", 120], ["2026-01-02", 130]],
    });
    expect(entries.find((e) => e.symbol === "^FCHI")?.variations.month).toBe(18.18);
  });

  it("matches computeVariations when the previous close is older than every reference", () => {
    const entries = expectSameAsFullHistory("2026-01-15", { "^FCHI": [["2025-11-01", 100], ["2026-01-15", 110]] });
    expect(entries.find((e) => e.symbol === "^FCHI")?.variations.day).toBe(10);
  });

  it("sorts the instruments by name with the French collation", () => {
    const names = overviewOf("2026-11-23", {}).map((e) => e.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "fr")));
  });
});
