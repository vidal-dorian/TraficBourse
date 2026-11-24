// Data of the « d'un coup d'œil » market tiles of the brief pages (US #21): per instrument, the
// last close known the morning of the brief, its day variation and the closes of the month before.
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { instruments, pricesDaily } from "../db/schema";
import { computeVariations, subtractOneMonth, type DatedClose } from "./snapshot";

export interface MarketTile {
  symbol: string;
  name: string;
  type: string;
  currency: string;
  lastClose: number | null;
  lastCloseDate: string | null;
  dayVariation: number | null;
  /** Closes from one calendar month before the last close date to that date, inclusive, oldest first. */
  curve: DatedClose[];
}

/**
 * One tile per instrument, ordered by name (French collation). Only closes dated before `briefDate` count: they are
 * the ones the prices job had stored when the brief was written (and `get_market_snapshot` showed).
 * Two bounded queries per instrument: the last two closes, then the one month window.
 */
export function getMarketTiles(db: Db, briefDate: string): MarketTile[] {
  return db
    .select()
    .from(instruments)
    .all()
    // Sorted here, not in SQL: SQLite compares bytes, so « iShares » would come after « S&P 500 ».
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
    .map((instrument) => {
      const lastTwo = db
        .select({ date: pricesDaily.date, close: pricesDaily.close })
        .from(pricesDaily)
        .where(and(eq(pricesDaily.symbol, instrument.symbol), lt(pricesDaily.date, briefDate)))
        .orderBy(desc(pricesDaily.date))
        .limit(2)
        .all();
      const { lastClose, lastCloseDate, variations } = computeVariations(lastTwo, briefDate);
      const curve =
        lastCloseDate === null
          ? []
          : db
              .select({ date: pricesDaily.date, close: pricesDaily.close })
              .from(pricesDaily)
              .where(
                and(
                  eq(pricesDaily.symbol, instrument.symbol),
                  gte(pricesDaily.date, subtractOneMonth(lastCloseDate)),
                  lt(pricesDaily.date, briefDate),
                ),
              )
              .orderBy(asc(pricesDaily.date))
              .all();
      return {
        symbol: instrument.symbol,
        name: instrument.name,
        type: instrument.type,
        currency: instrument.currency,
        lastClose,
        lastCloseDate,
        dayVariation: variations.day,
        curve,
      };
    });
}
