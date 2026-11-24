// Variations of one instrument (US #20), computed by the app so that Claude quotes the same
// figures as the charts. Pure: the caller reads the closes, this module only does the arithmetic.
import { subtractDays, subtractMonths } from "../dates/paris";

export interface DatedClose {
  /** "YYYY-MM-DD". */
  date: string;
  close: number;
}

export interface Variations {
  day: number | null;
  week: number | null;
  month: number | null;
  ytd: number | null;
}

export interface InstrumentVariations {
  lastClose: number | null;
  lastCloseDate: string | null;
  variations: Variations;
}

const NO_VARIATIONS: Variations = { day: null, week: null, month: null, ytd: null };

/** A reference range: the 5D / 1M / 3M / YTD / 1Y of a chart (week, month and ytd are those of the variations). */
export type ReferenceRange = "5D" | "1M" | "3M" | "YTD" | "1Y";

/** The day a `range` looks back to from `anchor` ("YYYY-MM-DD", the date of the last close). */
export function referenceDate(anchor: string, range: ReferenceRange): string {
  switch (range) {
    case "5D":
      return subtractDays(anchor, 7);
    case "1M":
      return subtractMonths(anchor, 1);
    case "3M":
      return subtractMonths(anchor, 3);
    case "YTD":
      return `${Number(anchor.slice(0, 4)) - 1}-12-31`;
    case "1Y":
      return subtractMonths(anchor, 12);
  }
}

/** `date` minus one calendar month, the day clamped to the end of the shorter month (31 March -> 28 February). */
export function subtractOneMonth(date: string): string {
  return subtractMonths(date, 1);
}

/** Percentage change from `reference` to `last`, rounded to 2 decimals; null without a usable reference. */
function percentChange(last: number, reference: number | undefined): number | null {
  if (reference === undefined || reference === 0) return null;
  return Math.round((last / reference - 1) * 10000) / 100;
}

/**
 * Last close on or before `date` and its 1 day, 1 week, 1 month and year-to-date variations, from
 * the closes of one instrument in any order. Closes after `date` are ignored. Each reference is
 * the last stored close on or before its target day (1 day: the stored close just before the last one).
 */
export function computeVariations(closes: readonly DatedClose[], date: string): InstrumentVariations {
  const known = closes.filter((entry) => entry.date <= date).sort((a, b) => a.date.localeCompare(b.date));
  const last = known.at(-1);
  if (!last) return { lastClose: null, lastCloseDate: null, variations: { ...NO_VARIATIONS } };

  const closeOnOrBefore = (target: string): number | undefined => known.findLast((entry) => entry.date <= target)?.close;
  return {
    lastClose: last.close,
    lastCloseDate: last.date,
    variations: {
      day: percentChange(last.close, known.at(-2)?.close),
      week: percentChange(last.close, closeOnOrBefore(referenceDate(last.date, "5D"))),
      month: percentChange(last.close, closeOnOrBefore(referenceDate(last.date, "1M"))),
      ytd: percentChange(last.close, closeOnOrBefore(referenceDate(last.date, "YTD"))),
    },
  };
}
