// Series of a news item's chart (US #22): closes of `prices_daily` only, cut to the range of the
// spec and optionally put in base 100. Claude sends a spec, never values.
import { and, asc, eq, gte, inArray, lte, max } from "drizzle-orm";
import type { Db } from "../db/client";
import { instruments, pricesDaily, type StoredChartSpec } from "../db/schema";
import { referenceDate, type DatedClose } from "./snapshot";

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

/**
 * The series of `spec` for the brief dated `endDate` ("YYYY-MM-DD"), from the closes of each symbol
 * in any order, with the reference rule of the snapshot variations: per symbol the anchor is the
 * last close on or before `endDate`, the base the last close on or before the reference date of
 * the range (the first close after it when the history is shorter), then every close up to the
 * anchor. Normalized values are 100 x close / base, 2 decimals, so the last one minus 100 is the
 * snapshot's variation. A symbol without close gets no point.
 */
export function computeChartSeries(
  spec: Pick<StoredChartSpec, "symbols" | "range" | "normalize">,
  closes: Readonly<Record<string, readonly DatedClose[]>>,
  endDate: string,
): ChartData {
  const series = spec.symbols.map((symbol): ChartSeries => {
    const known = (closes[symbol] ?? []).filter((entry) => entry.date <= endDate).sort((a, b) => a.date.localeCompare(b.date));
    const anchor = known.at(-1);
    if (!anchor) return { symbol, points: [] };

    const reference = referenceDate(anchor.date, spec.range);
    const baseIndex = Math.max(0, known.findLastIndex((entry) => entry.date <= reference));
    const shown = known.slice(baseIndex);
    const base = shown[0].close;
    // A zero base cannot be normalized: draw nothing rather than infinities.
    if (spec.normalize && base === 0) return { symbol, points: [] };
    return {
      symbol,
      points: shown.map(({ date, close }) => ({ date, value: spec.normalize ? Math.round((close / base) * 10000) / 100 : close })),
    };
  });
  return { range: spec.range, normalize: spec.normalize, series };
}

/** Closes of `symbol` from its base to its anchor for `range` and `endDate`: only what the series needs is read. */
function loadCloses(db: Db, symbol: string, range: StoredChartSpec["range"], endDate: string): DatedClose[] {
  const forSymbol = eq(pricesDaily.symbol, symbol);
  const anchor = db
    .select({ date: max(pricesDaily.date) })
    .from(pricesDaily)
    .where(and(forSymbol, lte(pricesDaily.date, endDate)))
    .get()?.date;
  if (!anchor) return [];

  const reference = referenceDate(anchor, range);
  const baseDate = db
    .select({ date: max(pricesDaily.date) })
    .from(pricesDaily)
    .where(and(forSymbol, lte(pricesDaily.date, reference)))
    .get()?.date;
  return db
    .select({ date: pricesDaily.date, close: pricesDaily.close })
    .from(pricesDaily)
    .where(and(forSymbol, gte(pricesDaily.date, baseDate ?? reference), lte(pricesDaily.date, anchor)))
    .orderBy(asc(pricesDaily.date))
    .all();
}

/** `computeChartSeries` on the closes stored in `prices_daily`, series named after `instruments`. */
export function loadChartData(db: Db, spec: StoredChartSpec, endDate: string): ChartData {
  const closes = Object.fromEntries(spec.symbols.map((symbol) => [symbol, loadCloses(db, symbol, spec.range, endDate)]));

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
