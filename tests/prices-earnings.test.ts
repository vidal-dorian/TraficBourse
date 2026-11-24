// US #25 — the prices job fills `instruments.last_earnings_date` for the watchlist stocks through the
// optional `getLastEarningsDate(providerSymbol, asOf)` method of the MarketDataProvider.
import { describe, expect, it } from "vitest";
import { runPricesJob } from "@/jobs/prices";
import { bar, fakeLogger, fakeProvider, openMigrated, priceRows } from "./helpers/prices";

// 2026-11-23 is a Monday; 2026-11-23T07:00Z is 08:00 in Paris.
const NOW = new Date("2026-11-23T07:00:00Z");

type Db = ReturnType<typeof openMigrated>["sqlite"];

function addInstrument(sqlite: Db, symbol: string, type: string, inWatchlist: boolean, earnings: string | null = null): void {
  sqlite
    .prepare("INSERT INTO instruments (symbol, provider_symbol, name, type, currency, in_watchlist) VALUES (?, ?, ?, ?, 'EUR', ?)")
    .run(symbol, symbol, symbol, type, inWatchlist ? 1 : 0);
  if (earnings !== null) sqlite.prepare("UPDATE instruments SET last_earnings_date = ? WHERE symbol = ?").run(earnings, symbol);
}

function earningsOf(sqlite: Db, symbol: string): string | null {
  const row = sqlite.prepare("SELECT last_earnings_date AS d FROM instruments WHERE symbol = ?").get(symbol) as { d: string | null };
  return row.d;
}

/** A fake provider with `getLastEarningsDate`, recording its calls; a symbol in `throwing` rejects. */
function withEarnings(
  base: ReturnType<typeof fakeProvider>,
  dates: Record<string, string | null>,
  throwing: string[] = [],
) {
  const earningsCalls: { providerSymbol: string; asOf: string }[] = [];
  return Object.assign(base, {
    earningsCalls,
    async getLastEarningsDate(providerSymbol: string, asOf: string): Promise<string | null> {
      earningsCalls.push({ providerSymbol, asOf });
      if (throwing.includes(providerSymbol)) throw new Error(`earnings boom ${providerSymbol}`);
      return dates[providerSymbol] ?? null;
    },
  });
}

describe("US #25 — the prices job stores the last earnings date of watchlist stocks", () => {
  it("given a watchlist stock, when the job runs, then it asks the provider with Paris today and stores the date", async () => {
    const { sqlite, db } = openMigrated();
    addInstrument(sqlite, "AIR.PA", "stock", true);
    const provider = withEarnings(fakeProvider({}), { "AIR.PA": "2026-11-19" });

    await runPricesJob({ db, provider, now: NOW, logger: fakeLogger() });

    expect(provider.earningsCalls).toEqual([{ providerSymbol: "AIR.PA", asOf: "2026-11-23" }]);
    expect(earningsOf(sqlite, "AIR.PA")).toBe("2026-11-19");
  });

  it("given a stock not in the watchlist, an ETF in the watchlist and the default indices, when the job runs, then none is asked for its earnings", async () => {
    const { sqlite, db } = openMigrated();
    addInstrument(sqlite, "OUT.PA", "stock", false);
    addInstrument(sqlite, "CW8.PA", "etf", true);
    const provider = withEarnings(fakeProvider({}), { "OUT.PA": "2026-11-19", "CW8.PA": "2026-11-19", "^FCHI": "2026-11-19" });

    await runPricesJob({ db, provider, now: NOW, logger: fakeLogger() });

    expect(provider.earningsCalls).toEqual([]);
    expect(earningsOf(sqlite, "OUT.PA")).toBeNull();
    expect(earningsOf(sqlite, "CW8.PA")).toBeNull();
  });

  it("given a stored date and a provider answering a newer one, when the job runs, then the stored date is overwritten", async () => {
    const { sqlite, db } = openMigrated();
    addInstrument(sqlite, "AIR.PA", "stock", true, "2026-07-30");
    const provider = withEarnings(fakeProvider({}), { "AIR.PA": "2026-11-19" });

    await runPricesJob({ db, provider, now: NOW, logger: fakeLogger() });

    expect(earningsOf(sqlite, "AIR.PA")).toBe("2026-11-19");
  });

  it("given a stored date and a provider answering null, when the job runs, then the stored date is kept", async () => {
    const { sqlite, db } = openMigrated();
    addInstrument(sqlite, "AIR.PA", "stock", true, "2026-07-30");
    const provider = withEarnings(fakeProvider({}), { "AIR.PA": null });

    await runPricesJob({ db, provider, now: NOW, logger: fakeLogger() });

    expect(provider.earningsCalls).toHaveLength(1);
    expect(earningsOf(sqlite, "AIR.PA")).toBe("2026-07-30");
  });

  it("given the earnings call throws for one stock, when the job runs, then it is logged, the bars are stored and the other stock still gets its date", async () => {
    const { sqlite, db } = openMigrated();
    addInstrument(sqlite, "AIR.PA", "stock", true);
    addInstrument(sqlite, "TTE.PA", "stock", true);
    const provider = withEarnings(
      fakeProvider({ "AIR.PA": [bar("2026-11-20", 100)], "TTE.PA": [bar("2026-11-20", 50)] }),
      { "TTE.PA": "2026-11-19" },
      ["AIR.PA"],
    );
    const logger = fakeLogger();

    const result = await runPricesJob({ db, provider, now: NOW, logger });

    expect(priceRows(sqlite, "AIR.PA")).toEqual([{ symbol: "AIR.PA", date: "2026-11-20", close: 100 }]);
    expect(result.failed.map((f) => f.symbol)).not.toContain("AIR.PA");
    expect(logger.errors.some((line) => line.includes("AIR.PA") && line.includes("earnings boom"))).toBe(true);
    expect(earningsOf(sqlite, "AIR.PA")).toBeNull();
    expect(earningsOf(sqlite, "TTE.PA")).toBe("2026-11-19");
  });

  it("given a provider without getLastEarningsDate, when the job runs, then it works as before and the date stays null", async () => {
    const { sqlite, db } = openMigrated();
    addInstrument(sqlite, "AIR.PA", "stock", true);
    const provider = fakeProvider({ "AIR.PA": [bar("2026-11-20", 100)] });

    const result = await runPricesJob({ db, provider, now: NOW, logger: fakeLogger() });

    expect(result.failed).toEqual([]);
    expect(priceRows(sqlite, "AIR.PA")).toHaveLength(1);
    expect(earningsOf(sqlite, "AIR.PA")).toBeNull();
  });

  it("given the bars of a watchlist stock fail, when the job runs, then the failure is reported as before", async () => {
    const { sqlite, db } = openMigrated();
    addInstrument(sqlite, "AIR.PA", "stock", true);
    const provider = withEarnings(fakeProvider({}, ["AIR.PA"]), { "AIR.PA": "2026-11-19" });

    const result = await runPricesJob({ db, provider, now: NOW, logger: fakeLogger() });

    expect(result.failed.map((f) => f.symbol)).toContain("AIR.PA");
  });
});
