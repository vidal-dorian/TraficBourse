// Variations of one instrument (US #20), computed by the app so that Claude quotes the same
// figures as the charts. Pure: the caller reads the closes, this module only does the arithmetic.
import { subtractDays } from "../dates/paris";

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

/** `date` minus one calendar month, the day clamped to the end of the shorter month (31 March -> 28 February). */
function subtractOneMonth(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const daysInPreviousMonth = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 2, Math.min(day, daysInPreviousMonth))).toISOString().slice(0, 10);
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
  const previousYearEnd = `${Number(last.date.slice(0, 4)) - 1}-12-31`;
  return {
    lastClose: last.close,
    lastCloseDate: last.date,
    variations: {
      day: percentChange(last.close, known.at(-2)?.close),
      week: percentChange(last.close, closeOnOrBefore(subtractDays(last.date, 7))),
      month: percentChange(last.close, closeOnOrBefore(subtractOneMonth(last.date))),
      ytd: percentChange(last.close, closeOnOrBefore(previousYearEnd)),
    },
  };
}
