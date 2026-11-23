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
    // Yahoo's period2 is exclusive: from as is, to + 1 day.
    expect(chart.mock.calls[0]?.[1]).toMatchObject({ interval: "1d", period1: "2026-11-20", period2: "2026-11-24" });
    expect(bars).toEqual([
      { date: "2026-11-20", open: 1, high: 3, low: 0.5, close: 2, volume: 10 },
      { date: "2026-11-23", open: 2, high: 4, low: 1, close: 3, volume: 20 },
    ]);
  });

  it("given a US exchange timezone, when a bar is at 14:30Z, then its date is the New York day", async () => {
    const chart = vi.fn(async (_symbol: string, _options: unknown) => ({
      meta: { exchangeTimezoneName: "America/New_York" },
      quotes: [{ date: new Date("2026-11-20T14:30:00Z"), open: 1, high: 2, low: 1, close: 2, volume: 5 }],
    }));
    const bars = await createYahooProvider({ chart } as never).getDailyBars("^GSPC", "2026-11-19", "2026-11-23");
    expect(bars.map((b) => b.date)).toEqual(["2026-11-20"]);
  });

  it("given an Asian exchange (Tokyo zone, or only a gmtoffset of +32400), when a bar is at 03:00Z, then its date is the local day", async () => {
    const quotes = [{ date: new Date("2026-11-21T03:00:00Z"), open: 1, high: 2, low: 1, close: 2, volume: 5 }];
    for (const meta of [{ exchangeTimezoneName: "Asia/Tokyo" }, { gmtoffset: 32400 }]) {
      const chart = vi.fn(async (_symbol: string, _options: unknown) => ({ meta, quotes }));
      const bars = await createYahooProvider({ chart } as never).getDailyBars("^N225", "2026-11-19", "2026-11-23");
      expect(bars.map((b) => b.date)).toEqual(["2026-11-21"]);
    }
  });
});
