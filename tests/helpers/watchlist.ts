// Shared doubles of the watchlist admin tests (US #24): a fake instrument search, no network.
import type { InstrumentSearchResult } from "../../src/lib/market/search";

export const AIR_LIQUIDE: InstrumentSearchResult = {
  providerSymbol: "AI.PA",
  name: "Air Liquide SA",
  exchange: "Paris",
  type: "stock",
  currency: "EUR",
};

export const AIR_LIQUIDE_OTC: InstrumentSearchResult = {
  providerSymbol: "AIQUY",
  name: "Air Liquide SA ADR",
  exchange: "OTC Markets OTCPK",
  type: "stock",
  currency: "USD",
};

/** A search double answering `byQuery[query]` (case-insensitive), recording every query. */
export function fakeSearch(byQuery: Record<string, InstrumentSearchResult[]>) {
  const queries: string[] = [];
  return {
    queries,
    async searchInstruments(query: string): Promise<InstrumentSearchResult[]> {
      queries.push(query);
      const key = Object.keys(byQuery).find((k) => k.toLowerCase() === query.trim().toLowerCase());
      return key ? byQuery[key] : [];
    },
  };
}
