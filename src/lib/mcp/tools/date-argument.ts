// The optional `date` argument of the read tools of the market data (get_market_snapshot, get_watchlist).
import { z } from "zod";

const DATE_MESSAGE = "Date attendue au format AAAA-MM-JJ, un jour réel du calendrier.";

/** "YYYY-MM-DD" naming a real calendar day (2026-02-30 is refused). */
function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Zod schema of an optional real calendar day; `description` tells Claude what the date means for the tool. */
export function optionalDate(description: string) {
  return z.string(DATE_MESSAGE).refine(isRealDate, DATE_MESSAGE).optional().describe(description);
}
