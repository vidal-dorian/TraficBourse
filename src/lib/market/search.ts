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
  /** Empty when the source does not say (Yahoo search): the real one is looked up when adding. */
  currency: string;
}

export interface InstrumentSearchProvider {
  searchInstruments(query: string): Promise<InstrumentSearchResult[]>;
}

/** Gives the trading currency of a symbol ("EUR", or a minor unit such as "GBp"); rejects when unknown. */
export interface CurrencyLookup {
  currencyOf(providerSymbol: string): Promise<string>;
}
