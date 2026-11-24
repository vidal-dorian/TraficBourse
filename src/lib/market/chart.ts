// Series of a news item's chart (US #22): closes of `prices_daily` only, cut to the range of the
// spec and optionally put in base 100. Claude sends a spec, never values.
import { asc, inArray } from "drizzle-orm";
import { subtractDays, subtractMonths } from "../dates/paris";
import type { Db } from "../db/client";
import { instruments, pricesDaily, type StoredChartSpec } from "../db/schema";
import type { DatedClose } from "./snapshot";

export interface ChartSeries {
  symbol: string;
  /** Instrument name; only set by `loadChartData`. */
  name?: string;
  points: { date: string; value: number }[];
}

export interface ChartData {
  range: StoredChartSpec["range"];
  normalize: boolean;
  /** In the order of the spec's symbols. */
  series: ChartSeries[];
}

/** Day before the first day of the window ending on `endDate` (the window is `> start`, `<= endDate`). */
function windowStart(range: StoredChartSpec["range"], endDate: string): string {
  switch (range) {
    case "5D":
      // The window holds 6 calendar days (end - 5 .. end): the acceptance tests exclude end - 6.
      return subtractDays(endDate, 6);
    case "1M":
      return subtractMonths(endDate, 1);
    case "3M":
      return subtractMonths(endDate, 3);
    case "YTD":
      return `${Number(endDate.slice(0, 4)) - 1}-12-31`;
    case "1Y":
      return subtractMonths(endDate, 12);
  }
}

/**
 * The series of `spec` ending on `endDate` ("YYYY-MM-DD", the brief date) from the closes of each
 * symbol, in any order. Normalized values are 100 x close / first close of the window, 2 decimals.
 * A symbol without close in the window gets no point.
 */
export function computeChartSeries(
  spec: Pick<StoredChartSpec, "symbols" | "range" | "normalize">,
  closes: Readonly<Record<string, readonly DatedClose[]>>,
  endDate: string,
): ChartData {
  const start = windowStart(spec.range, endDate);
  const series = spec.symbols.map((symbol): ChartSeries => {
    const inWindow = (closes[symbol] ?? [])
      .filter((entry) => entry.date > start && entry.date <= endDate)
      .sort((a, b) => a.date.localeCompare(b.date));
    const base = inWindow[0]?.close;
    // A zero base cannot be normalized: draw nothing rather than infinities.
    if (spec.normalize && base === 0) return { symbol, points: [] };
    return {
      symbol,
      points: inWindow.map(({ date, close }) => ({
        date,
        value: spec.normalize && base ? Math.round((close / base) * 10000) / 100 : close,
      })),
    };
  });
  return { range: spec.range, normalize: spec.normalize, series };
}

/** `computeChartSeries` on the closes stored in `prices_daily`, series named after `instruments`. */
export function loadChartData(db: Db, spec: StoredChartSpec, endDate: string): ChartData {
  const rows = db
    .select({ symbol: pricesDaily.symbol, date: pricesDaily.date, close: pricesDaily.close })
    .from(pricesDaily)
    .where(inArray(pricesDaily.symbol, spec.symbols))
    .orderBy(asc(pricesDaily.date))
    .all();
  const closes: Record<string, DatedClose[]> = {};
  for (const { symbol, date, close } of rows) (closes[symbol] ??= []).push({ date, close });

  const names = new Map(
    db
      .select({ symbol: instruments.symbol, name: instruments.name })
      .from(instruments)
      .where(inArray(instruments.symbol, spec.symbols))
      .all()
      .map((row) => [row.symbol, row.name]),
  );
  const data = computeChartSeries(spec, closes, endDate);
  return { ...data, series: data.series.map((series) => ({ ...series, name: names.get(series.symbol) ?? series.symbol })) };
}
