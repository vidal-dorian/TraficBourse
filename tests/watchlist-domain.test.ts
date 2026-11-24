// US #24 — C90 and C91: adding a stock follows it and fetches a year of history; removing it
// stops following it but keeps the instrument and its history.
//
// Contract (`src/lib/watchlist/watchlist.ts`):
// - `addToWatchlist(db, { result, provider, now? }): Promise<{ symbol: string; stored: number }>`
//   - `result` is an InstrumentSearchResult (src/lib/market/search.ts), `provider` a MarketDataProvider.
//   - Creates the instrument: `symbol` = `provider_symbol` = result.providerSymbol, `name`, `type`,
//     `exchange`, `currency` from the result, `in_watchlist` = true.
//   - An instrument that already exists (e.g. a default one, or a previously removed stock) is not
//     recreated nor renamed: only `in_watchlist` becomes true.
//   - Fetches the bars through `provider.getDailyBars(providerSymbol, from, to)` with
//     from = Paris today − 1 year, to = Paris today, and upserts them in `prices_daily` with the
//     rules of the prices job: bars dated Paris today are not stored. `stored` = rows written.
//   - A provider failure rejects, but the instrument stays followed (the prices job will fill it).
// - `removeFromWatchlist(db, symbol): boolean`: sets `in_watchlist` = false and deletes nothing
//   (instrument row and prices_daily rows stay). Returns false for an unknown symbol.
// - `listWatchlist(db): { symbol; name; exchange: string | null }[]`: followed instruments, by name.
import { describe, expect, it } from "vitest";
import { bar, fakeProvider, openMigrated, priceRows } from "./helpers/prices";
import { AIR_LIQUIDE } from "./helpers/watchlist";

// Monday 2026-11-23, 08:00 in Paris.
const NOW = new Date("2026-11-23T07:00:00Z");

function instrumentRow(sqlite: ReturnType<typeof openMigrated>["sqlite"], symbol: string) {
  return sqlite.prepare("SELECT * FROM instruments WHERE symbol = ?").get(symbol) as
    | { symbol: string; provider_symbol: string; name: string; type: string; exchange: string | null; currency: string; in_watchlist: number }
    | undefined;
}

describe("C90 — adding a result creates and follows the instrument, with one year of history", () => {
  it("C90 — given a search result, when I add it, then the instrument is created and marked as followed", async () => {
    const { addToWatchlist } = await import("../src/lib/watchlist/watchlist");
    const { sqlite, db } = openMigrated();
    const provider = fakeProvider({ "AI.PA": [bar("2026-11-20", 170)] });

    await addToWatchlist(db, { result: AIR_LIQUIDE, provider, now: NOW });

    expect(instrumentRow(sqlite, "AI.PA")).toEqual({
      symbol: "AI.PA",
      provider_symbol: "AI.PA",
      name: "Air Liquide SA",
      type: "stock",
      exchange: "Paris",
      currency: "EUR",
      in_watchlist: 1,
      fallback_symbol: null,
      last_earnings_date: null,
    });
  });

  it("C90 — given a search result, when I add it, then its history is fetched from Paris today minus one year and stored", async () => {
    const { addToWatchlist } = await import("../src/lib/watchlist/watchlist");
    const { sqlite, db } = openMigrated();
    const provider = fakeProvider({
      "AI.PA": [bar("2025-11-21", 150), bar("2025-11-24", 151), bar("2026-11-19", 170), bar("2026-11-20", 171), bar("2026-11-23", 172)],
    });

    const outcome = await addToWatchlist(db, { result: AIR_LIQUIDE, provider, now: NOW });

    expect(provider.calls).toEqual([{ providerSymbol: "AI.PA", from: "2025-11-23", to: "2026-11-23" }]);
    expect(priceRows(sqlite, "AI.PA").map((r) => r.date)).toEqual(["2025-11-24", "2026-11-19", "2026-11-20"]);
    expect(outcome).toEqual({ symbol: "AI.PA", stored: 3 });
  });

  it("C90 — given an instrument that already exists unfollowed, when I add it, then it is only marked as followed", async () => {
    const { addToWatchlist } = await import("../src/lib/watchlist/watchlist");
    const { sqlite, db } = openMigrated();
    const provider = fakeProvider({ "^FCHI": [bar("2026-11-20", 8000)] });

    await addToWatchlist(db, {
      result: { providerSymbol: "^FCHI", name: "Another name", exchange: "Elsewhere", type: "stock", currency: "USD" },
      provider,
      now: NOW,
    });

    const row = instrumentRow(sqlite, "^FCHI");
    expect(row?.in_watchlist).toBe(1);
    expect(row?.name).not.toBe("Another name");
    expect(row?.type).toBe("index");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM instruments").get()).toEqual({ n: 9 });
  });

  it("C90 — given I add the same result twice, then there is one instrument and no duplicate price", async () => {
    const { addToWatchlist } = await import("../src/lib/watchlist/watchlist");
    const { sqlite, db } = openMigrated();
    const provider = fakeProvider({ "AI.PA": [bar("2026-11-19", 170), bar("2026-11-20", 171)] });

    await addToWatchlist(db, { result: AIR_LIQUIDE, provider, now: NOW });
    await addToWatchlist(db, { result: AIR_LIQUIDE, provider, now: NOW });

    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM instruments WHERE symbol = 'AI.PA'").get()).toEqual({ n: 1 });
    expect(priceRows(sqlite, "AI.PA")).toHaveLength(2);
  });

  it("C90 — given the provider fails, when I add the result, then the add rejects but the stock stays followed", async () => {
    const { addToWatchlist } = await import("../src/lib/watchlist/watchlist");
    const { sqlite, db } = openMigrated();
    const provider = fakeProvider({}, ["AI.PA"]);

    await expect(addToWatchlist(db, { result: AIR_LIQUIDE, provider, now: NOW })).rejects.toThrow();

    expect(instrumentRow(sqlite, "AI.PA")?.in_watchlist).toBe(1);
    expect(priceRows(sqlite, "AI.PA")).toEqual([]);
  });

  it("C90 — given followed stocks, when the watchlist is listed, then it shows them by name with their listing place", async () => {
    const { addToWatchlist, listWatchlist } = await import("../src/lib/watchlist/watchlist");
    const { db } = openMigrated();
    const provider = fakeProvider({});

    await addToWatchlist(db, { result: AIR_LIQUIDE, provider, now: NOW });
    await addToWatchlist(db, {
      result: { providerSymbol: "AIR.PA", name: "Airbus SE", exchange: "Paris", type: "stock", currency: "EUR" },
      provider,
      now: NOW,
    });

    expect(listWatchlist(db)).toEqual([
      { symbol: "AIR.PA", name: "Airbus SE", exchange: "Paris" },
      { symbol: "AI.PA", name: "Air Liquide SA", exchange: "Paris" },
    ].sort((a, b) => a.name.localeCompare(b.name, "fr")));
  });
});

describe("C91 — removing a stock keeps its history", () => {
  it("C91 — given a followed stock, when I remove it, then it is no longer followed", async () => {
    const { addToWatchlist, removeFromWatchlist, listWatchlist } = await import("../src/lib/watchlist/watchlist");
    const { sqlite, db } = openMigrated();
    await addToWatchlist(db, { result: AIR_LIQUIDE, provider: fakeProvider({ "AI.PA": [bar("2026-11-20", 171)] }), now: NOW });

    expect(removeFromWatchlist(db, "AI.PA")).toBe(true);

    expect(instrumentRow(sqlite, "AI.PA")?.in_watchlist).toBe(0);
    expect(listWatchlist(db)).toEqual([]);
  });

  it("C91 — given a followed stock with history, when I remove it, then the instrument and its prices stay", async () => {
    const { addToWatchlist, removeFromWatchlist } = await import("../src/lib/watchlist/watchlist");
    const { sqlite, db } = openMigrated();
    await addToWatchlist(db, {
      result: AIR_LIQUIDE,
      provider: fakeProvider({ "AI.PA": [bar("2026-11-19", 170), bar("2026-11-20", 171)] }),
      now: NOW,
    });

    removeFromWatchlist(db, "AI.PA");

    expect(instrumentRow(sqlite, "AI.PA")).toBeDefined();
    expect(priceRows(sqlite, "AI.PA").map((r) => r.date)).toEqual(["2026-11-19", "2026-11-20"]);
  });

  it("C91 — given a removed stock, when I add it again, then it is followed again with its history intact", async () => {
    const { addToWatchlist, removeFromWatchlist } = await import("../src/lib/watchlist/watchlist");
    const { sqlite, db } = openMigrated();
    const provider = fakeProvider({ "AI.PA": [bar("2026-11-20", 171)] });
    await addToWatchlist(db, { result: AIR_LIQUIDE, provider, now: NOW });
    removeFromWatchlist(db, "AI.PA");

    await addToWatchlist(db, { result: AIR_LIQUIDE, provider, now: NOW });

    expect(instrumentRow(sqlite, "AI.PA")?.in_watchlist).toBe(1);
    expect(priceRows(sqlite, "AI.PA")).toHaveLength(1);
  });

  it("C91 — given an unknown symbol, when I remove it, then nothing changes and it answers false", async () => {
    const { removeFromWatchlist } = await import("../src/lib/watchlist/watchlist");
    const { sqlite, db } = openMigrated();

    expect(removeFromWatchlist(db, "NOPE.PA")).toBe(false);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM instruments").get()).toEqual({ n: 9 });
  });
});
