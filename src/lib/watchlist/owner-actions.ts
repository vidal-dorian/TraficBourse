// Write entry points of the watchlist admin (US #24). Next.js server actions can be POSTed to any
// path with a `Next-Action` header, which the middleware's matcher never sees, so each one
// re-verifies the Cloudflare Access token itself, before any fetch or write (same rules as
// src/middleware.ts, fail closed).
import { isAdminAuthDisabled, readAccessConfig, verifyAccessToken } from "../auth/cloudflare-access";
import type { Db } from "../db/client";
import { INSTRUMENT_TYPES } from "../db/schema";
import type { MarketDataProvider } from "../market/provider";
import type { InstrumentSearchProvider, InstrumentSearchResult } from "../market/search";
import { addToWatchlist, removeFromWatchlist } from "./watchlist";

export interface OwnerContext {
  headers: Headers;
  env: Record<string, string | undefined>;
  db: Db;
  provider: MarketDataProvider;
  /**
   * When set, the added result is re-resolved through it (after the Access check): the form fields
   * come from the browser, so name, type and exchange are replaced by what the search says.
   */
  search?: InstrumentSearchProvider;
  now?: Date;
}

export type AddOutcome =
  | { ok: true; symbol: string; stored: number }
  | { ok: false; reason: "forbidden" | "invalid" | "not_found" | "search_failed" }
  /** The stock is followed but its history could not be fetched: the prices job will fill it. */
  | { ok: false; reason: "history_failed"; symbol: string };

export type RemoveOutcome = { ok: true } | { ok: false; reason: "forbidden" | "invalid" | "not_found" };

const SYMBOL = /^[A-Za-z0-9^][A-Za-z0-9.^=-]{0,19}$/;
const CURRENCY = /^[A-Z]{3}$/;

async function isOwner(ctx: Pick<OwnerContext, "headers" | "env">): Promise<boolean> {
  if (isAdminAuthDisabled(ctx.env)) return true;
  const accessConfig = readAccessConfig(ctx.env);
  if (!accessConfig.ok) {
    console.error(`Watchlist action refused: invalid Access config (${accessConfig.problems.join("; ")})`);
    return false;
  }
  const result = await verifyAccessToken(ctx.headers.get("cf-access-jwt-assertion"), accessConfig.config);
  return result.ok;
}

/** The result with trimmed, bounded fields, or null when anything is off. */
function validate(result: InstrumentSearchResult): InstrumentSearchResult | null {
  if (typeof result !== "object" || result === null) return null;
  const { providerSymbol, name, exchange, type, currency } = result;
  if (typeof providerSymbol !== "string" || !SYMBOL.test(providerSymbol)) return null;
  if (typeof name !== "string" || name.trim() === "" || name.length > 200) return null;
  if (exchange !== null && (typeof exchange !== "string" || exchange.length > 100)) return null;
  if (!INSTRUMENT_TYPES.includes(type)) return null;
  if (typeof currency !== "string" || !CURRENCY.test(currency)) return null;
  return { providerSymbol, name: name.trim(), exchange: exchange?.trim() || null, type, currency };
}

export async function addStockAsOwner(ctx: OwnerContext, result: InstrumentSearchResult): Promise<AddOutcome> {
  if (!(await isOwner(ctx))) return { ok: false, reason: "forbidden" };

  let checked = validate(result);
  if (!checked) return { ok: false, reason: "invalid" };

  if (ctx.search) {
    try {
      const hits = await ctx.search.searchInstruments(checked.providerSymbol);
      const hit = hits.map(validate).find((candidate) => candidate?.providerSymbol === checked?.providerSymbol);
      if (!hit) return { ok: false, reason: "not_found" };
      checked = hit;
    } catch (error) {
      console.error(`Watchlist add: search failed: ${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, reason: "search_failed" };
    }
  }

  try {
    const outcome = await addToWatchlist(ctx.db, { result: checked, provider: ctx.provider, now: ctx.now });
    return { ok: true, ...outcome };
  } catch (error) {
    console.error(`Watchlist add: history of ${checked.providerSymbol} failed: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, reason: "history_failed", symbol: checked.providerSymbol };
  }
}

export async function removeStockAsOwner(
  ctx: Pick<OwnerContext, "headers" | "env" | "db">,
  symbol: string,
): Promise<RemoveOutcome> {
  if (!(await isOwner(ctx))) return { ok: false, reason: "forbidden" };
  if (typeof symbol !== "string" || !SYMBOL.test(symbol)) return { ok: false, reason: "invalid" };
  return removeFromWatchlist(ctx.db, symbol) ? { ok: true } : { ok: false, reason: "not_found" };
}
