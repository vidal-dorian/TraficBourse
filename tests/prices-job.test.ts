// US #18 — the app fetches the closing prices by itself (criteria 72 to 75).
import { describe, expect, it } from "vitest";
import { runPricesJob } from "@/jobs/prices";
import { bar, DEFAULT_SYMBOLS, fakeLogger, fakeProvider, openMigrated, priceRows } from "./helpers/prices";

// 2026-11-23 is a Monday; 2026-11-23T07:00Z is 08:00 in Paris.
const NOW = new Date("2026-11-23T07:00:00Z");

function allBars(close: (i: number) => number, dates: string[]) {
  return Object.fromEntries(DEFAULT_SYMBOLS.map((s, i) => [s, dates.map((d) => bar(d, close(i)))]));
}

describe("criterion 72 — latest close of every default instrument is stored", () => {
  it("given a freshly migrated database, then the 9 default instruments exist with their Yahoo symbols, none in the watchlist", () => {
    const { sqlite } = openMigrated();
    const rows = sqlite.prepare("SELECT symbol, provider_symbol, in_watchlist FROM instruments").all() as {
      symbol: string;
      provider_symbol: string;
      in_watchlist: number;
    }[];
    expect(rows.map((r) => r.symbol).sort()).toEqual([...DEFAULT_SYMBOLS].sort());
    for (const r of rows) {
      expect(r.provider_symbol).toBe(r.symbol);
      expect(r.in_watchlist).toBe(0);
    }
  });

  it("given the default instruments, when the job runs, then the latest close of each is recorded in prices_daily", async () => {
    const { sqlite, db } = openMigrated();
    const provider = fakeProvider(allBars((i) => 100 + i, ["2026-11-20", "2026-11-23"]));
    const result = await runPricesJob({ db, provider, now: NOW, logger: fakeLogger() });

    expect(result.failed).toEqual([]);
    expect(result.updated.map((u) => u.symbol).sort()).toEqual([...DEFAULT_SYMBOLS].sort());
    DEFAULT_SYMBOLS.forEach((symbol, i) => {
      const rows = priceRows(sqlite, symbol);
      expect(rows.at(-1)).toEqual({ symbol, date: "2026-11-23", close: 100 + i });
    });
  });
});

describe("criterion 73 — first run fetches one year of history", () => {
  it("given an instrument without history, when the job runs for the first time, then it fetches from Paris today minus 1 year to Paris today and stores every bar", async () => {
    const { sqlite, db } = openMigrated();
    const dates: string[] = [];
    for (let d = new Date("2025-11-23T00:00:00Z"); d <= new Date("2026-11-23T00:00:00Z"); d = new Date(d.getTime() + 86_400_000)) {
      dates.push(d.toISOString().slice(0, 10));
    }
    const provider = fakeProvider({ "^FCHI": dates.map((d, i) => bar(d, 7000 + i)) });
    await runPricesJob({ db, provider, now: NOW, logger: fakeLogger() });

    const call = provider.calls.find((c) => c.providerSymbol === "^FCHI");
    expect(call).toEqual({ providerSymbol: "^FCHI", from: "2025-11-23", to: "2026-11-23" });
    expect(priceRows(sqlite, "^FCHI")).toHaveLength(dates.length);
  });

  it("given a time just before midnight UTC, when the job runs, then the window uses the Paris date (2026-11-22T23:30Z is 2026-11-23 in Paris)", async () => {
    const { db } = openMigrated();
    const provider = fakeProvider({});
    await runPricesJob({ db, provider, now: new Date("2026-11-22T23:30:00Z"), logger: fakeLogger() });
    for (const call of provider.calls) {
      expect(call.from).toBe("2025-11-23");
      expect(call.to).toBe("2026-11-23");
    }
    expect(provider.calls.length).toBe(DEFAULT_SYMBOLS.length);
  });

  it("given an instrument that already has history, when the job runs, then it fetches from its last stored date (inclusive)", async () => {
    const { sqlite, db } = openMigrated();
    sqlite
      .prepare("INSERT INTO prices_daily (symbol, date, close) VALUES ('^FCHI', '2026-11-18', 7000), ('^FCHI', '2026-11-19', 7010)")
      .run();
    const provider = fakeProvider({});
    await runPricesJob({ db, provider, now: NOW, logger: fakeLogger() });

    expect(provider.calls.find((c) => c.providerSymbol === "^FCHI")).toEqual({
      providerSymbol: "^FCHI",
      from: "2026-11-19",
      to: "2026-11-23",
    });
    // Another instrument with no history still gets its full year.
    expect(provider.calls.find((c) => c.providerSymbol === "^GSPC")?.from).toBe("2025-11-23");
  });
});

describe("criterion 74 — running again the same day creates no duplicate", () => {
  it("given a job already run today, when it runs again, then the row count is unchanged and no (symbol, date) is duplicated", async () => {
    const { sqlite, db } = openMigrated();
    const provider = fakeProvider(allBars((i) => 100 + i, ["2026-11-20", "2026-11-23"]));
    await runPricesJob({ db, provider, now: NOW, logger: fakeLogger() });
    const before = priceRows(sqlite);
    await runPricesJob({ db, provider, now: NOW, logger: fakeLogger() });
    const after = priceRows(sqlite);

    expect(after).toEqual(before);
    expect(new Set(after.map((r) => `${r.symbol}|${r.date}`)).size).toBe(after.length);
  });

  it("given a close revised by the provider, when the job runs again, then the stored value is updated, not duplicated", async () => {
    const { sqlite, db } = openMigrated();
    await runPricesJob({ db, provider: fakeProvider({ "^FCHI": [bar("2026-11-23", 7000)] }), now: NOW, logger: fakeLogger() });
    await runPricesJob({ db, provider: fakeProvider({ "^FCHI": [bar("2026-11-23", 7123)] }), now: NOW, logger: fakeLogger() });

    expect(priceRows(sqlite, "^FCHI")).toEqual([{ symbol: "^FCHI", date: "2026-11-23", close: 7123 }]);
  });
});

describe("criterion 75 — a failing symbol does not stop the others", () => {
  it("given one symbol in error, when the job runs, then the others are stored, the failure is reported and logged with the symbol", async () => {
    const { sqlite, db } = openMigrated();
    const provider = fakeProvider(allBars((i) => 100 + i, ["2026-11-23"]), ["^NDX"]);
    const logger = fakeLogger();
    const result = await runPricesJob({ db, provider, now: NOW, logger });

    expect(result.failed.map((f) => f.symbol)).toEqual(["^NDX"]);
    expect(result.failed[0]?.error).toContain("boom");
    expect(result.updated.map((u) => u.symbol).sort()).toEqual(DEFAULT_SYMBOLS.filter((s) => s !== "^NDX").sort());
    expect(priceRows(sqlite, "^NDX")).toEqual([]);
    for (const s of DEFAULT_SYMBOLS.filter((s) => s !== "^NDX")) expect(priceRows(sqlite, s)).toHaveLength(1);
    expect(logger.errors.some((m) => m.includes("^NDX"))).toBe(true);
  });
});
