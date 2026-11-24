// Port of the instrument search (US #24): the admin watchlist page only knows this interface, so
// the source (Yahoo today, unofficial) can be swapped like the MarketDataProvider.
import type { INSTRUMENT_TYPES } from "../db/schema";

export interface InstrumentSearchResult {
  /** Symbol of the market-data provider, also the app's own key once added. */
  providerSymbol: string;
  name: string;
  /** Display name of the listing place ("Paris"), null when unknown. */
  exchange: string | null;
  type: (typeof INSTRUMENT_TYPES)[number];
  currency: string;
}

export interface InstrumentSearchProvider {
  searchInstruments(query: string): Promise<InstrumentSearchResult[]>;
}

const CURRENCY_BY_SUFFIX: Record<string, string> = {
  PA: "EUR", AS: "EUR", DE: "EUR", F: "EUR", MI: "EUR", MC: "EUR", BR: "EUR", LS: "EUR", HE: "EUR", VI: "EUR", IR: "EUR",
  L: "GBP", SW: "CHF", T: "JPY", HK: "HKD", TO: "CAD",
};

/**
 * Yahoo's search gives no currency and the chart provider only returns bars, so the currency is
 * a best guess from the symbol: a crypto pair ends with its quote currency ("BTC-EUR"), a listing
 * suffix maps to its usual currency (".PA" EUR), and a bare symbol is a US listing (USD). It is
 * informational only: no number of the app is converted with it.
 */
export function guessCurrency(providerSymbol: string): string {
  const pair = /-([A-Z]{3})$/.exec(providerSymbol);
  if (pair) return pair[1];
  const suffix = /\.([A-Z]{1,2})$/.exec(providerSymbol)?.[1];
  return (suffix && CURRENCY_BY_SUFFIX[suffix]) || "USD";
}
