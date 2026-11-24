// US #22 (C84, C86) — the series of a chart, from closes only, consistent with the variations of
// `get_market_snapshot` (`computeVariations`) so the text Claude writes matches the curve.
//
// Contract (`src/lib/market/chart.ts`):
// - pure `computeChartSeries(spec, closes, endDate)`; `closes` is `Record<symbol, {date, close}[]>`,
//   `endDate` the brief date "YYYY-MM-DD". Returns `{ range, normalize, series: { symbol, points:
//   {date, value}[] }[] }`, series in spec symbol order, points in date order.
// - per symbol: anchor = date of its last close on or before endDate (none: `points: []`).
//   Reference date: 5D anchor - 7 days; 1M / 3M same day 1 / 3 calendar months before the anchor
//   (day clamped); YTD 31 December of the anchor's previous year; 1Y same day one year before
//   (29 Feb clamped to 28 Feb).
// - base = last close on or before the reference date. Points = the base close, then every close
//   with base date < date <= anchor. With no close on or before the reference (short history), the
//   base is the first close after it. Closes after endDate are ignored, closes before the base
//   are not shown.
// - normalize: value = 100 x close / base close, 2 decimals (first point 100); otherwise the raw
//   close. So last normalized value - 100 equals the snapshot variation (week / month / ytd).
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
  it("given normalize true, when computed, then the base is the close on the reference date (100) and the others are 100 x close / base, 2 decimals", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(
      spec({ symbols: ["^FCHI", "^GSPC"], normalize: true }),
      {
        "^FCHI": [c("2026-10-20", 1), c("2026-10-23", 8000), c("2026-11-10", 8100), c("2026-11-23", 8240)],
        "^GSPC": [c("2026-10-23", 3), c("2026-11-10", 4), c("2026-11-23", 5)],
      },
      "2026-11-23",
    );
    expect(result.range).toBe("1M");
    expect(result.normalize).toBe(true);
    expect(result.series.map((s) => s.symbol)).toEqual(["^FCHI", "^GSPC"]);
    expect(values(result.series[0])).toEqual([100, 101.25, 103]);
    expect(dates(result.series[0])).toEqual(["2026-10-23", "2026-11-10", "2026-11-23"]);
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
});

describe("C84 — the last normalized value agrees with the snapshot variations", () => {
  const CLOSES = [
    c("2025-12-30", 100),
    c("2025-12-31", 200),
    c("2026-01-02", 210),
    c("2026-10-19", 240),
    c("2026-10-21", 280),
    c("2026-11-13", 270),
    c("2026-11-19", 297),
    c("2026-11-20", 300),
    c("2026-11-23", 999),
  ];

  it.each([
    ["1M", "month"],
    ["5D", "week"],
    ["YTD", "ytd"],
  ] as const)("given the range %s, when normalized, then last value - 100 equals the snapshot's %s variation", async (range, key) => {
    const { computeChartSeries } = await chartModule();
    const { computeVariations } = await import("../../src/lib/market/snapshot");
    const result = computeChartSeries(spec({ range, normalize: true }), { "^FCHI": CLOSES }, "2026-11-20");
    const points = result.series[0].points;
    const expected = computeVariations(CLOSES, "2026-11-20").variations[key];
    expect(expected).not.toBeNull();
    expect(points[0].value).toBe(100);
    expect(Math.round(((points.at(-1)?.value ?? 0) - 100) * 100) / 100).toBe(expected);
    expect(points.at(-1)?.date).toBe("2026-11-20");
  });
});

describe("C86 — the window follows the snapshot's reference rule", () => {
  it("given 1M ending 2026-11-23, when computed, then the base is the close ON 2026-10-23, nothing before, nothing after the end", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(
      spec(),
      { "^FCHI": [c("2026-10-22", 1), c("2026-10-23", 2), c("2026-10-24", 3), c("2026-11-23", 4), c("2026-11-24", 5)] },
      "2026-11-23",
    );
    expect(dates(result.series[0])).toEqual(["2026-10-23", "2026-10-24", "2026-11-23"]);
  });

  it("given no close on the reference date, when computed, then the base is the last close before it", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(
      spec({ normalize: true }),
      { "^FCHI": [c("2026-10-21", 1), c("2026-10-22", 50), c("2026-10-26", 100), c("2026-11-23", 150)] },
      "2026-11-23",
    );
    expect(dates(result.series[0])).toEqual(["2026-10-22", "2026-10-26", "2026-11-23"]);
    expect(values(result.series[0])).toEqual([100, 200, 300]);
  });

  it("given a history shorter than the range, when computed, then the base is the first close after the reference", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(
      spec({ normalize: true }),
      { "^FCHI": [c("2026-11-03", 220), c("2026-11-02", 200)] },
      "2026-11-23",
    );
    expect(dates(result.series[0])).toEqual(["2026-11-02", "2026-11-03"]);
    expect(values(result.series[0])).toEqual([100, 110]);
  });

  it("given the last close is before the brief date, when computed, then the reference is counted from that close, not from the brief date", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(
      spec(),
      { "^FCHI": [c("2026-10-20", 1), c("2026-10-23", 2), c("2026-11-20", 3), c("2026-11-24", 9)] },
      "2026-11-23",
    );
    expect(dates(result.series[0])).toEqual(["2026-10-20", "2026-10-23", "2026-11-20"]);
  });

  it("given 1M ending on the 31st, when the previous month is shorter, then the reference day is clamped (2026-03-31 starts at 2026-02-28)", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(spec(), { "^FCHI": [c("2026-02-27", 1), c("2026-02-28", 2), c("2026-03-01", 3), c("2026-03-31", 4)] }, "2026-03-31");
    expect(dates(result.series[0])).toEqual(["2026-02-28", "2026-03-01", "2026-03-31"]);
  });

  it("given 5D ending 2026-11-23, when computed, then the base is the close of 2026-11-16 and 2026-11-13 is out", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(spec({ range: "5D" }), { "^FCHI": [c("2026-11-13", 1), c("2026-11-16", 2), c("2026-11-17", 3), c("2026-11-23", 4)] }, "2026-11-23");
    expect(dates(result.series[0])).toEqual(["2026-11-16", "2026-11-17", "2026-11-23"]);
  });

  it("given 3M ending 2026-11-23, when computed, then the base is the close of 2026-08-23", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(spec({ range: "3M" }), { "^FCHI": [c("2026-08-22", 1), c("2026-08-23", 2), c("2026-08-24", 3), c("2026-11-23", 9)] }, "2026-11-23");
    expect(dates(result.series[0])).toEqual(["2026-08-23", "2026-08-24", "2026-11-23"]);
  });

  it("given YTD ending 2026-11-23, when computed, then the base is the close of 2025-12-31", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(spec({ range: "YTD" }), { "^FCHI": [c("2025-12-30", 1), c("2025-12-31", 2), c("2026-01-02", 3)] }, "2026-11-23");
    expect(dates(result.series[0])).toEqual(["2025-12-31", "2026-01-02"]);
  });

  it("given 1Y ending 2026-11-23, when computed, then the base is the close of 2025-11-23", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(spec({ range: "1Y" }), { "^FCHI": [c("2025-11-22", 1), c("2025-11-23", 2), c("2025-11-24", 3), c("2026-11-23", 9)] }, "2026-11-23");
    expect(dates(result.series[0])).toEqual(["2025-11-23", "2025-11-24", "2026-11-23"]);
  });

  it("given 1Y ending on 2028-02-29, when computed, then the reference day is clamped to 2027-02-28", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(spec({ range: "1Y" }), { "^FCHI": [c("2027-02-27", 1), c("2027-02-28", 2), c("2027-03-01", 3), c("2028-02-29", 9)] }, "2028-02-29");
    expect(dates(result.series[0])).toEqual(["2027-02-28", "2027-03-01", "2028-02-29"]);
  });

  it("given a symbol with no close on or before the brief date, when computed, then its series is empty and the others are kept", async () => {
    const { computeChartSeries } = await chartModule();
    const result = computeChartSeries(
      spec({ symbols: ["^FCHI", "^GSPC"], normalize: true }),
      { "^FCHI": [c("2026-12-01", 1)], "^GSPC": [c("2026-11-02", 5)] },
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
    for (const [d, v] of [["2026-10-22", 10], ["2026-10-23", 100], ["2026-10-26", 105], ["2026-11-23", 110], ["2026-11-24", 999]] as const) insert.run("^FCHI", d, v);
    insert.run("^GSPC", "2026-11-20", 7);

    const result = await loadChartData(db, spec({ symbols: ["^FCHI", "^GSPC"], normalize: true }), "2026-11-23");

    expect(result.series.map((s) => [s.symbol, s.name])).toEqual([
      ["^FCHI", "CAC 40"],
      ["^GSPC", "S&P 500"],
    ]);
    expect(result.series[0].points).toEqual([
      { date: "2026-10-23", value: 100 },
      { date: "2026-10-26", value: 105 },
      { date: "2026-11-23", value: 110 },
    ]);
    expect(result.series[1].points).toEqual([{ date: "2026-11-20", value: 100 }]);
    sqlite.close();
  });
});
