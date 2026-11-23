// US #18 — the Yahoo implementation of MarketDataProvider, with an injected fake client (no network).
import { describe, expect, it, vi } from "vitest";
import { createYahooProvider } from "@/lib/market/yahoo";

describe("US #18 — Yahoo provider mapping", () => {
  it("given a chart response, when bars are requested, then closes are mapped to YYYY-MM-DD bars and null closes are skipped", async () => {
    const chart = vi.fn(async (_symbol: string, _options: unknown) => ({
      quotes: [
        { date: new Date("2026-11-20T08:00:00Z"), open: 1, high: 3, low: 0.5, close: 2, volume: 10 },
        { date: new Date("2026-11-21T08:00:00Z"), open: null, high: null, low: null, close: null, volume: null },
        { date: new Date("2026-11-23T08:00:00Z"), open: 2, high: 4, low: 1, close: 3, volume: 20 },
      ],
    }));
    const provider = createYahooProvider({ chart } as never);

    const bars = await provider.getDailyBars("^FCHI", "2026-11-20", "2026-11-23");

    expect(provider.name).toBeTruthy();
    expect(chart).toHaveBeenCalledTimes(1);
    expect(chart.mock.calls[0]?.[0]).toBe("^FCHI");
    expect(chart.mock.calls[0]?.[1]).toMatchObject({ interval: "1d" });
    expect(bars).toEqual([
      { date: "2026-11-20", open: 1, high: 3, low: 0.5, close: 2, volume: 10 },
      { date: "2026-11-23", open: 2, high: 4, low: 1, close: 3, volume: 20 },
    ]);
  });
});
