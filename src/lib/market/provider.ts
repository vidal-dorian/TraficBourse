// Port of the market-data source: the prices job only knows this interface, so the provider
// (Yahoo today, unofficial and liable to break) can be swapped without touching it.

/** One trading day of an instrument; `date` is the exchange's local day, "YYYY-MM-DD". */
export interface DailyBar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

export interface MarketDataProvider {
  /** Short name for the logs. */
  readonly name: string;
  /** Daily bars of `providerSymbol` from `from` to `to`, both inclusive ("YYYY-MM-DD"). */
  getDailyBars(providerSymbol: string, from: string, to: string): Promise<DailyBar[]>;
}
