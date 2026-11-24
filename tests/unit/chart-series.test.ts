// US #22 (C84, C86) — the series of a chart, from closes only.
//
// Contract (`src/lib/market/chart.ts`):
// - pure `computeChartSeries(spec, closes, endDate)`; `closes` is `Record<symbol, {date, close}[]>`,
//   `endDate` the brief date "YYYY-MM-DD". Returns `{ range, normalize, series: { symbol, points:
//   {date, value}[] }[] }`, series in spec symbol order, points in date order.
// - window: dates > start and <= endDate; start = endDate - 7 days (5D), same day 1 / 3 calendar
//   months earlier, day clamped (1M, 3M), 31 December of the previous year (YTD), same day one
//   year earlier (1Y).
// - normalize: value = 100 * close / first close of the window, rounded to 2 decimals; otherwise
//   the raw close. A symbol with no close in the window gets `points: []`.
// - `loadChartData(db, spec, endDate)` reads `prices_daily` (and names from `instruments`) only and
//   returns the same shape plus each series' `name`.
import { describe, expect, it } from "vitest";
import { openMigrated } from "../helpers/prices";

type Spec = { type: "price"; symbols: string[]; range: "5D" | "1M" | "3M" | "YTD" | "1Y"; normalize: boolean };
type Close = { date: string; close: number };
type Series = { symbol: string; name?: string; points: { date: string; value: number }[] };
type Result = { range: string; normalize: boolean; series: Series[] };

async function chartModule() {
  const mod = (await import("../../src/lib/market/chart")) as unknown as {
    computeChartSeries: (spec: Spec, closes: Record<string, Close[]>, endDate: string) => Result;
    loadChartData: (db: unknown, spec: Spec, endDate: string) => Result | Promise<Result>;
  };
  return mod;
}

function spec(overrides: Partial<Spec> = {}): Spec {
  return { type: "price", symbols: ["^FCHI"], range: "1M", normalize: false, ...overrides };
}

const c = (date: string, close: number): Close => ({ date, close });
const dates = (series: Series) => series.points.map((p) => p.date);
const values = (series: Series) => series.points.map((p) => p.value);

describe("C84 — computeChartSeries normalizes to base 100", () => {
  it("given normalize true, when computed, then the first point is 100 and the others are 100 x close / first close, 2 decimals", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(
      spec({ symbols: ["^FCHI", "^GSPC"], normalize: true }),
      {
        "^FCHI": [c("2026-10-26", 8000), c("2026-11-10", 8100), c("2026-11-23", 8240)],
        "^GSPC": [c("2026-10-26", 3), c("2026-11-10", 4), c("2026-11-23", 5)],
      },
      "2026-11-23",
    );
    expect(result.range).toBe("1M");
    expect(result.normalize).toBe(true);
    expect(result.series.map((s) => s.symbol)).toEqual(["^FCHI", "^GSPC"]);
    expect(values(result.series[0])).toEqual([100, 101.25, 103]);
    expect(values(result.series[1])).toEqual([100, 133.33, 166.67]);
  });

  it("given normalize false, when computed, then the values are the raw closes", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(spec(), { "^FCHI": [c("2026-11-02", 7000.5), c("2026-11-03", 7100)] }, "2026-11-23");
    expect(result.normalize).toBe(false);
    expect(values(result.series[0])).toEqual([7000.5, 7100]);
  });

  it("given unsorted closes, when computed, then points are in date order", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(spec(), { "^FCHI": [c("2026-11-03", 2), c("2026-11-02", 1)] }, "2026-11-23");
    expect(dates(result.series[0])).toEqual(["2026-11-02", "2026-11-03"]);
  });

  it("given a normalized series, when the first close of the window is not the first stored close, then the base is the first close of the window", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(
      spec({ normalize: true }),
      { "^FCHI": [c("2026-09-01", 1), c("2026-11-02", 200), c("2026-11-03", 250)] },
      "2026-11-23",
    );
    expect(values(result.series[0])).toEqual([100, 125]);
  });
});

describe("C86 — the window only keeps closes in the range", () => {
  it("given 1M ending 2026-11-23, when computed, then 2026-10-24 to 2026-11-23 are kept, before and after are not", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(
      spec(),
      { "^FCHI": [c("2026-10-23", 1), c("2026-10-24", 2), c("2026-11-23", 3), c("2026-11-24", 4)] },
      "2026-11-23",
    );
    expect(dates(result.series[0])).toEqual(["2026-10-24", "2026-11-23"]);
  });

  it("given 1M ending on the 31st, when the previous month is shorter, then the day is clamped (2026-03-31 starts after 2026-02-28)", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(spec(), { "^FCHI": [c("2026-02-28", 1), c("2026-03-01", 2)] }, "2026-03-31");
    expect(dates(result.series[0])).toEqual(["2026-03-01"]);
  });

  it("given 5D ending 2026-11-23, when computed, then 2026-11-17 is out and 2026-11-18 is in", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(spec({ range: "5D" }), { "^FCHI": [c("2026-11-16", 1), c("2026-11-17", 2), c("2026-11-18", 3)] }, "2026-11-23");
    expect(dates(result.series[0])).toEqual(["2026-11-18"]);
  });

  it("given 3M ending 2026-11-23, when computed, then 2026-08-23 is out and 2026-08-24 is in", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(spec({ range: "3M" }), { "^FCHI": [c("2026-08-23", 1), c("2026-08-24", 2)] }, "2026-11-23");
    expect(dates(result.series[0])).toEqual(["2026-08-24"]);
  });

  it("given YTD ending 2026-11-23, when computed, then 2025-12-31 is out and 2026-01-02 is in", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(spec({ range: "YTD" }), { "^FCHI": [c("2025-12-31", 1), c("2026-01-02", 2)] }, "2026-11-23");
    expect(dates(result.series[0])).toEqual(["2026-01-02"]);
  });

  it("given 1Y ending 2026-11-23, when computed, then 2025-11-23 is out and 2025-11-24 is in", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(spec({ range: "1Y" }), { "^FCHI": [c("2025-11-23", 1), c("2025-11-24", 2)] }, "2026-11-23");
    expect(dates(result.series[0])).toEqual(["2025-11-24"]);
  });

  it("given a symbol with no close in the window, when computed, then its series is empty and the others are kept", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(
      spec({ symbols: ["^FCHI", "^GSPC"], normalize: true }),
      { "^FCHI": [c("2026-01-02", 1)], "^GSPC": [c("2026-11-02", 5)] },
      "2026-11-23",
    );
    expect(result.series.map((s) => s.symbol)).toEqual(["^FCHI", "^GSPC"]);
    expect(result.series[0].points).toEqual([]);
    expect(values(result.series[1])).toEqual([100]);
  });

  it("given a symbol absent from closes, when computed, then its series is empty", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(spec(), {}, "2026-11-23");
    expect(result.series).toEqual([{ symbol: "^FCHI", points: [] }]);
  });
});

describe("C86 — loadChartData reads prices_daily and instruments only", () => {
  it("given closes in prices_daily, when loaded, then series carry the instrument names and the stored closes inside the window", async () => {
    const { loadChartData } = await chartModule();
    const { sqlite, db } = openMigrated();
    const insert = sqlite.prepare("INSERT INTO prices_daily (symbol, date, close) VALUES (?, ?, ?)");
    for (const [d, v] of [["2026-10-23", 50], ["2026-10-26", 100], ["2026-11-23", 110], ["2026-11-24", 999]] as const) insert.run("^FCHI", d, v);
    insert.run("^GSPC", "2026-11-20", 7);

    const result = await loadChartData(db, spec({ symbols: ["^FCHI", "^GSPC"], normalize: true }), "2026-11-23");

    expect(result.series.map((s) => [s.symbol, s.name])).toEqual([
      ["^FCHI", "CAC 40"],
      ["^GSPC", "S&P 500"],
    ]);
    expect(result.series[0].points).toEqual([
      { date: "2026-10-26", value: 100 },
      { date: "2026-11-23", value: 110 },
    ]);
    expect(result.series[1].points).toEqual([{ date: "2026-11-20", value: 100 }]);
    sqlite.close();
  });
});
