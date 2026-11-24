// US #24 — C89: searching an instrument by name returns name, symbol and listing place.
//
// Contract:
// - `src/lib/market/search.ts` exports the port:
//     interface InstrumentSearchResult { providerSymbol: string; name: string; exchange: string | null;
//       type: "index"|"etf"|"stock"|"fx"|"crypto"|"commodity"; currency: string }
//     interface InstrumentSearchProvider { searchInstruments(query: string): Promise<InstrumentSearchResult[]> }
// - `src/lib/market/yahoo-search.ts` exports `createYahooSearch(client?: YahooSearchClient)`:
//   an InstrumentSearchProvider over yahoo-finance2's `search`. `YahooSearchClient` is
//   `{ search(query: string, options?: unknown): Promise<{ quotes: Quote[] }> }` where a quote has
//   `symbol`, `shortname?`, `longname?`, `exchange?`, `exchDisp?` (display name of the listing place),
//   `quoteType?` ("EQUITY" | "ETF" | "INDEX" | "CURRENCY" | "CRYPTOCURRENCY" | "FUTURE" | other).
//   Mapping: name = longname ?? shortname; exchange = exchDisp ?? exchange ?? null;
//   type: EQUITY→stock, ETF→etf, INDEX→index, CURRENCY→fx, CRYPTOCURRENCY→crypto, FUTURE→commodity;
//   quotes without symbol, without a name, or of another quote type (e.g. OPTION) are dropped.
//   A blank query returns [] without calling the client. Tests inject a fake client: no network.
import { describe, expect, it } from "vitest";

function fakeClient(quotes: Record<string, unknown>[]) {
  const calls: string[] = [];
  return {
    calls,
    async search(query: string) {
      calls.push(query);
      return { quotes };
    },
  };
}

describe("C89 — search results carry name, symbol and listing place", () => {
  it("C89 — given Yahoo answers for « Air Liquide », when I search, then each result has its name, symbol and listing place", async () => {
    const { createYahooSearch } = await import("../src/lib/market/yahoo-search");
    const client = fakeClient([
      { symbol: "AI.PA", shortname: "AIR LIQUIDE", longname: "L'Air Liquide S.A.", exchange: "PAR", exchDisp: "Paris", quoteType: "EQUITY" },
      { symbol: "AIQUY", shortname: "AIR LIQUIDE ADR", exchange: "PNK", exchDisp: "OTC Markets OTCPK", quoteType: "EQUITY" },
    ]);

    const results = await createYahooSearch(client).searchInstruments("Air Liquide");

    expect(client.calls).toEqual(["Air Liquide"]);
    expect(results).toEqual([
      expect.objectContaining({ providerSymbol: "AI.PA", name: "L'Air Liquide S.A.", exchange: "Paris", type: "stock" }),
      expect.objectContaining({ providerSymbol: "AIQUY", name: "AIR LIQUIDE ADR", exchange: "OTC Markets OTCPK", type: "stock" }),
    ]);
  });

  it("C89 — given quotes of several kinds, when I search, then the quote type maps to the instrument type and unusable quotes are dropped", async () => {
    const { createYahooSearch } = await import("../src/lib/market/yahoo-search");
    const client = fakeClient([
      { symbol: "IWDA.AS", shortname: "iShares MSCI World", exchDisp: "Amsterdam", quoteType: "ETF" },
      { symbol: "^FCHI", shortname: "CAC 40", exchDisp: "Paris", quoteType: "INDEX" },
      { symbol: "BTC-EUR", shortname: "Bitcoin EUR", exchDisp: "CCC", quoteType: "CRYPTOCURRENCY" },
      { symbol: "AI240621C00100000", shortname: "AI option", quoteType: "OPTION" },
      { shortname: "No symbol", quoteType: "EQUITY" },
      { symbol: "NONAME.PA", quoteType: "EQUITY" },
    ]);

    const results = await createYahooSearch(client).searchInstruments("x");

    expect(results.map((r) => [r.providerSymbol, r.type])).toEqual([
      ["IWDA.AS", "etf"],
      ["^FCHI", "index"],
      ["BTC-EUR", "crypto"],
    ]);
  });

  it("C89 — given a blank query, when I search, then there is no result and Yahoo is not called", async () => {
    const { createYahooSearch } = await import("../src/lib/market/yahoo-search");
    const client = fakeClient([{ symbol: "AI.PA", shortname: "AIR LIQUIDE", quoteType: "EQUITY" }]);

    expect(await createYahooSearch(client).searchInstruments("   ")).toEqual([]);
    expect(client.calls).toEqual([]);
  });
});
