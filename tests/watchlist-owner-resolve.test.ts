// US #24 — the add action never trusts the form: addStockAsOwner re-resolves the result through
// ctx.search and the currency through ctx.currencies (after the Access check).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bar, fakeProvider, openMigrated } from "./helpers/prices";
import { AIR_LIQUIDE, fakeSearch } from "./helpers/watchlist";
import { addStockAsOwner } from "../src/lib/watchlist/owner-actions";

const NOW = new Date("2026-11-23T07:00:00Z");
// Local-dev switch: Access is not what these tests are about (see watchlist-admin-access.test.ts).
const env = { ADMIN_AUTH_DISABLED: "true" };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function setup(currency: string | Error = "EUR") {
  const { sqlite, db } = openMigrated();
  const provider = fakeProvider({ "AI.PA": [bar("2026-11-20", 171)] });
  const currencies = {
    async currencyOf() {
      if (currency instanceof Error) throw currency;
      return currency;
    },
  };
  const search = fakeSearch({ "AI.PA": [{ ...AIR_LIQUIDE, currency: "" }] });
  const ctx = { headers: new Headers(), env, db, provider, search, currencies, now: NOW };
  const row = () => sqlite.prepare("SELECT name, type, exchange, currency, in_watchlist FROM instruments WHERE symbol = 'AI.PA'").get();
  return { ctx, provider, search, row };
}

describe("addStockAsOwner resolves the result server side", () => {
  it("overwrites tampered fields with the searched values and the looked-up currency", async () => {
    const { ctx, row } = setup("GBp");
    const outcome = await addStockAsOwner(ctx, { providerSymbol: "AI.PA", name: "Evil", exchange: "Mars", type: "etf", currency: "" });

    expect(outcome).toEqual({ ok: true, symbol: "AI.PA", stored: 1 });
    expect(row()).toEqual({ name: "Air Liquide SA", type: "stock", exchange: "Paris", currency: "GBp", in_watchlist: 1 });
  });

  it("answers not_found for a symbol the search does not return, without fetching", async () => {
    const { ctx, provider } = setup();
    expect(await addStockAsOwner(ctx, { ...AIR_LIQUIDE, providerSymbol: "ZZZ.PA" })).toEqual({ ok: false, reason: "not_found" });
    expect(provider.calls).toEqual([]);
  });

  it("answers search_failed when the search throws", async () => {
    const { ctx, row } = setup();
    ctx.search = { searchInstruments: async () => Promise.reject(new Error("down")) } as never;
    expect(await addStockAsOwner(ctx, AIR_LIQUIDE)).toEqual({ ok: false, reason: "search_failed" });
    expect(row()).toBeUndefined();
  });

  it("refuses an invalid symbol, a type that is not offered, and a blank currency without lookup", async () => {
    const { ctx, search } = setup();
    expect(await addStockAsOwner(ctx, { ...AIR_LIQUIDE, providerSymbol: "AI.PA; DROP" })).toEqual({ ok: false, reason: "invalid" });
    expect(await addStockAsOwner(ctx, { ...AIR_LIQUIDE, type: "crypto" })).toEqual({ ok: false, reason: "invalid" });
    expect(await addStockAsOwner(ctx, { ...AIR_LIQUIDE, type: "bogus" as never })).toEqual({ ok: false, reason: "invalid" });
    expect(await addStockAsOwner({ ...ctx, currencies: undefined, search: undefined }, { ...AIR_LIQUIDE, currency: "" })).toEqual({ ok: false, reason: "invalid" });
    expect(search.queries).toEqual([]);
  });

  it("refuses the add when the currency lookup fails, instead of guessing", async () => {
    const { ctx, row, provider } = setup(new Error("no quote"));
    expect(await addStockAsOwner(ctx, AIR_LIQUIDE)).toEqual({ ok: false, reason: "currency_failed" });
    expect(row()).toBeUndefined();
    expect(provider.calls).toEqual([]);
  });

  it("answers history_failed when the bars fail, the stock staying followed", async () => {
    const { ctx, row } = setup();
    ctx.provider = fakeProvider({}, ["AI.PA"]);
    expect(await addStockAsOwner(ctx, AIR_LIQUIDE)).toEqual({ ok: false, reason: "history_failed", symbol: "AI.PA" });
    expect(row()).toMatchObject({ in_watchlist: 1 });
  });

  it("answers write_failed, not history_failed, when the instrument write itself fails", async () => {
    const { ctx } = setup();
    ctx.db = { insert: () => { throw new Error("disk full"); } } as never;
    expect(await addStockAsOwner(ctx, AIR_LIQUIDE)).toEqual({ ok: false, reason: "write_failed" });
  });
});
