// InstrumentSearchProvider backed by yahoo-finance2's `search` (unofficial Yahoo Finance API).
import YahooFinance from "yahoo-finance2";
import type { CurrencyLookup, InstrumentSearchProvider, InstrumentSearchResult } from "./search";

interface YahooQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  exchDisp?: string;
  quoteType?: string;
}

/** The part of the yahoo-finance2 client this provider uses (so tests can inject a fake). */
export interface YahooSearchClient {
  search(query: string, options?: unknown): Promise<{ quotes: YahooQuote[] }>;
}

const TYPE_BY_QUOTE_TYPE: Record<string, InstrumentSearchResult["type"]> = {
  EQUITY: "stock",
  ETF: "etf",
  INDEX: "index",
  CURRENCY: "fx",
  CRYPTOCURRENCY: "crypto",
  FUTURE: "commodity",
};

/** The part of the yahoo-finance2 client the currency lookup uses (so tests can inject a fake). */
export interface YahooQuoteClient {
  quote(symbol: string): Promise<{ currency?: string } | undefined>;
}

function defaultClient(): YahooSearchClient {
  const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  return {
    search: async (query, options) => {
      const response = await yahoo.search(query, { quotesCount: 10, newsCount: 0, ...(options as object) });
      return { quotes: response.quotes as YahooQuote[] };
    },
  };
}

export function createYahooSearch(client: YahooSearchClient = defaultClient()): InstrumentSearchProvider {
  return {
    async searchInstruments(query) {
      if (query.trim() === "") return [];
      const { quotes } = await client.search(query);
      const results: InstrumentSearchResult[] = [];
      for (const quote of quotes) {
        const name = quote.longname ?? quote.shortname;
        const type = quote.quoteType ? TYPE_BY_QUOTE_TYPE[quote.quoteType] : undefined;
        if (!quote.symbol || !name || !type) continue;
        results.push({
          providerSymbol: quote.symbol,
          name,
          exchange: quote.exchDisp ?? quote.exchange ?? null,
          type,
          currency: "",
        });
      }
      return results;
    },
  };
}

/** Currency from Yahoo's quote of the symbol, as Yahoo writes it ("GBp" for London pence). */
export function createYahooCurrencyLookup(
  client: YahooQuoteClient = new YahooFinance({ suppressNotices: ["yahooSurvey"] }) as unknown as YahooQuoteClient,
): CurrencyLookup {
  return {
    async currencyOf(providerSymbol) {
      const currency = (await client.quote(providerSymbol))?.currency;
      if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) throw new Error(`no currency for ${providerSymbol}`);
      return currency;
    },
  };
}
