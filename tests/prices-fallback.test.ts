// US #19 — when Yahoo fails, the symbols Twelve Data covers are fetched from it (criterion 76).
import { describe, expect, it } from "vitest";
import { runPricesJob } from "@/jobs/prices";
import { bar, DEFAULT_SYMBOLS, fakeLogger, fakeProvider, openMigrated, priceRows } from "./helpers/prices";

// Monday 2026-11-23, 08:00 in Paris.
const NOW = new Date("2026-11-23T07:00:00Z");

function fallbackProvider(bars: Record<string, ReturnType<typeof bar>[]>, failing: string[] = []) {
  const p = fakeProvider(bars, failing);
  return Object.assign(p, { name: "twelvedata" });
}

describe("criterion 76 — migration 0006 seeds the Twelve Data symbols", () => {
  it("given a freshly migrated database, then EURUSD=X maps to EUR/USD, BTC-EUR to BTC/EUR and the others to null", () => {
    const { sqlite } = openMigrated();
    const rows = sqlite.prepare("SELECT symbol, fallback_symbol FROM instruments").all() as {
      symbol: string;
      fallback_symbol: string | null;
    }[];
    const map = Object.fromEntries(rows.map((r) => [r.symbol, r.fallback_symbol]));
    expect(Object.keys(map).sort()).toEqual([...DEFAULT_SYMBOLS].sort());
    expect(map["EURUSD=X"]).toBe("EUR/USD");
    expect(map["BTC-EUR"]).toBe("BTC/EUR");
    for (const s of DEFAULT_SYMBOLS.filter((s) => s !== "EURUSD=X" && s !== "BTC-EUR")) expect(map[s]).toBeNull();
  });
});

describe("criterion 76 — fallback in the prices job", () => {
  it("given Yahoo failing for every symbol, when the job runs, then EUR/USD and BTC come from the fallback under their Twelve Data symbols, stored under the app symbol, with their source; the others fail", async () => {
    const { sqlite, db } = openMigrated();
    const provider = fakeProvider({}, DEFAULT_SYMBOLS);
    const fallback = fallbackProvider({
      "EUR/USD": [bar("2026-11-19", 1.05), bar("2026-11-20", 1.06), bar("2026-11-23", 1.07)],
      "BTC/EUR": [bar("2026-11-22", 91_000)],
    });
    const logger = fakeLogger();
    const result = await runPricesJob({ db, provider, fallback, now: NOW, logger });

    expect(fallback.calls.map((c) => c.providerSymbol).sort()).toEqual(["BTC/EUR", "EUR/USD"]);
    expect(fallback.calls.find((c) => c.providerSymbol === "EUR/USD")).toEqual({
      providerSymbol: "EUR/USD",
      from: "2025-11-23",
      to: "2026-11-23",
    });
    expect(result.updated.map((u) => u.symbol).sort()).toEqual(["BTC-EUR", "EURUSD=X"]);
    expect(result.updated.every((u) => u.source === "twelvedata")).toBe(true);
    expect(result.updated.find((u) => u.symbol === "EURUSD=X")?.bars).toBe(2);
    expect(result.failed.map((f) => f.symbol).sort()).toEqual(
      DEFAULT_SYMBOLS.filter((s) => s !== "EURUSD=X" && s !== "BTC-EUR").sort(),
    );
    // Stored under the app symbol; the bar dated Paris today is dropped.
    expect(priceRows(sqlite, "EURUSD=X").map((r) => r.date)).toEqual(["2026-11-19", "2026-11-20"]);
    expect(priceRows(sqlite, "BTC-EUR")).toEqual([{ symbol: "BTC-EUR", date: "2026-11-22", close: 91_000 }]);
    expect(priceRows(sqlite, "EUR/USD")).toEqual([]);
    // The Yahoo error and the fallback used are logged.
    expect(logger.errors.concat(logger.infos).join("\n")).toMatch(/boom EURUSD=X/);
    expect(logger.errors.concat(logger.infos).join("\n")).toMatch(/twelvedata/);
  });

  it("given the fallback restarts from the last stored day, when the job runs again, then it asks the fallback from that day", async () => {
    const { db } = openMigrated();
    const provider = fakeProvider({}, ["EURUSD=X"]);
    const fallback = fallbackProvider({ "EUR/USD": [bar("2026-11-20", 1.06)] });
    await runPricesJob({ db, provider, fallback, now: NOW, logger: fakeLogger() });
    fallback.calls.length = 0;
    await runPricesJob({ db, provider, fallback, now: NOW, logger: fakeLogger() });
    expect(fallback.calls.find((c) => c.providerSymbol === "EUR/USD")?.from).toBe("2026-11-20");
  });

  it("given the primary succeeds, when the job runs, then the fallback is never called and the source is the primary's name", async () => {
    const { db } = openMigrated();
    const provider = fakeProvider(Object.fromEntries(DEFAULT_SYMBOLS.map((s) => [s, [bar("2026-11-20", 100)]])));
    const fallback = fallbackProvider({});
    const result = await runPricesJob({ db, provider, fallback, now: NOW, logger: fakeLogger() });
    expect(fallback.calls).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.updated.every((u) => u.source === "fake")).toBe(true);
  });

  it("given only EUR/USD fails at Yahoo, when the job runs, then only it is asked of the fallback", async () => {
    const { db } = openMigrated();
    const provider = fakeProvider(
      Object.fromEntries(DEFAULT_SYMBOLS.map((s) => [s, [bar("2026-11-20", 100)]])),
      ["EURUSD=X"],
    );
    const fallback = fallbackProvider({ "EUR/USD": [bar("2026-11-20", 1.06)] });
    const result = await runPricesJob({ db, provider, fallback, now: NOW, logger: fakeLogger() });
    expect(fallback.calls.map((c) => c.providerSymbol)).toEqual(["EUR/USD"]);
    expect(result.failed).toEqual([]);
    expect(result.updated.find((u) => u.symbol === "EURUSD=X")?.source).toBe("twelvedata");
  });

  it("given the fallback fails too, when the job runs, then the symbol is failed with both errors and nothing is stored", async () => {
    const { sqlite, db } = openMigrated();
    const provider = fakeProvider({}, ["BTC-EUR"]);
    const fallback = fallbackProvider({}, ["BTC/EUR"]);
    const result = await runPricesJob({ db, provider, fallback, now: NOW, logger: fakeLogger() });
    const failed = result.failed.find((f) => f.symbol === "BTC-EUR");
    expect(failed?.error).toMatch(/boom BTC-EUR/);
    expect(failed?.error).toMatch(/boom BTC\/EUR/);
    expect(priceRows(sqlite, "BTC-EUR")).toEqual([]);
  });

  it("given no fallback, when Yahoo fails, then the symbol is failed as before and no source is invented", async () => {
    const { db } = openMigrated();
    const provider = fakeProvider({ "^FCHI": [bar("2026-11-20", 7000)] }, ["EURUSD=X"]);
    const result = await runPricesJob({ db, provider, now: NOW, logger: fakeLogger() });
    expect(result.failed.find((f) => f.symbol === "EURUSD=X")?.error).toMatch(/boom EURUSD=X/);
    expect(result.updated.find((u) => u.symbol === "^FCHI")).toMatchObject({ symbol: "^FCHI", bars: 1, source: "fake" });
  });

  it("given an instrument without fallback symbol (CAC 40), when Yahoo fails, then the fallback is not asked and it is failed", async () => {
    const { db } = openMigrated();
    const provider = fakeProvider({}, ["^FCHI"]);
    const fallback = fallbackProvider({});
    const result = await runPricesJob({ db, provider, fallback, now: NOW, logger: fakeLogger() });
    expect(fallback.calls.find((c) => c.providerSymbol === "^FCHI")).toBeUndefined();
    expect(result.failed.map((f) => f.symbol)).toContain("^FCHI");
  });
});
