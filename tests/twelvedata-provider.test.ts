// US #19 — the Twelve Data implementation of MarketDataProvider (criterion 76), with an injected
// fake fetch, sleep and clock (no network, no real waiting).
import { describe, expect, it, vi } from "vitest";
import { createTwelveDataProvider } from "@/lib/market/twelvedata";

const KEY = "sekret-key-123";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const OK = {
  status: "ok",
  values: [
    { datetime: "2026-11-23", open: "1.0900", high: "1.1000", low: "1.0800", close: "1.0950", volume: "12" },
    { datetime: "2026-11-20", open: "1.05", high: "1.07", low: "1.04", close: "1.06" },
    { datetime: "2026-11-18", open: "1.0", high: "1.0", low: "1.0", close: "1.0" },
    { datetime: "2026-11-19", open: "bad", high: null, low: "1", close: "1.02", volume: "" },
    { datetime: "2026-11-21", open: "1", high: "1", low: "1", close: "n/a" },
  ],
};

function setup(responses: (() => Response | Promise<Response>)[] = [() => json(OK)]) {
  const fetch = vi.fn(async (_url: string | URL | Request) => {
    const next = responses.length > 1 ? responses.shift()! : responses[0];
    return next();
  });
  let clock = 1_000_000;
  const starts: number[] = [];
  const wrapped = vi.fn(async (url: string | URL | Request) => {
    starts.push(clock);
    return fetch(url);
  });
  const sleep = vi.fn(async (ms: number) => {
    clock += ms;
  });
  const provider = createTwelveDataProvider({ apiKey: KEY, fetch: wrapped as never, sleep, now: () => clock });
  return { provider, fetch: wrapped, sleep, starts, advance: (ms: number) => (clock += ms) };
}

function urlOf(fetch: { mock: { calls: unknown[][] } }, i = 0): URL {
  const arg = fetch.mock.calls[i][0];
  return new URL(typeof arg === "string" ? arg : arg instanceof URL ? arg.href : (arg as Request).url);
}

describe("criterion 76 — Twelve Data provider", () => {
  it("given a symbol and a window, when bars are requested, then time_series is called with symbol, 1day interval, dates (end exclusive: to + 1 day) and the apikey", async () => {
    const { provider, fetch } = setup();
    expect(provider.name).toBe("twelvedata");
    await provider.getDailyBars("EUR/USD", "2026-11-19", "2026-11-23");

    expect(fetch).toHaveBeenCalledTimes(1);
    const url = urlOf(fetch);
    expect(url.origin + url.pathname).toBe("https://api.twelvedata.com/time_series");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      symbol: "EUR/USD",
      interval: "1day",
      start_date: "2026-11-19",
      end_date: "2026-11-24",
      apikey: KEY,
      outputsize: "5000",
      timezone: "Exchange",
    });
  });

  it("given string numbers, when parsed, then bars are numeric, sorted ascending, filtered to from..to, unparseable optional fields are null and a value without a close is skipped", async () => {
    const { provider } = setup();
    const bars = await provider.getDailyBars("EUR/USD", "2026-11-19", "2026-11-23");
    expect(bars).toEqual([
      { date: "2026-11-19", open: null, high: null, low: 1, close: 1.02, volume: null },
      { date: "2026-11-20", open: 1.05, high: 1.07, low: 1.04, close: 1.06, volume: null },
      { date: "2026-11-23", open: 1.09, high: 1.1, low: 1.08, close: 1.095, volume: 12 },
    ]);
  });

  it("given an API error body, when bars are requested, then it throws an Error that does not contain the API key", async () => {
    const { provider } = setup([() => json({ status: "error", code: 401, message: `apikey ${KEY} is invalid` })]);
    const error = await provider.getDailyBars("AAPL", "2026-11-19", "2026-11-23").then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(KEY);
  });

  it("given a non-2xx HTTP status or a network error whose message holds the URL, when bars are requested, then it throws without leaking the key", async () => {
    for (const responder of [
      () => json({}, 500),
      () => {
        throw new Error(`fetch failed https://api.twelvedata.com/time_series?apikey=${KEY}`);
      },
    ]) {
      const { provider } = setup([responder]);
      const error = await provider.getDailyBars("AAPL", "2026-11-19", "2026-11-23").then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(KEY);
    }
  });

  it("given two successive requests, when the second comes at once, then the first does not wait and the second waits so that starts are at least minIntervalMs apart (default 8000)", async () => {
    const { provider, sleep, starts } = setup();
    await provider.getDailyBars("EUR/USD", "2026-11-19", "2026-11-23");
    expect(sleep).not.toHaveBeenCalled();
    await provider.getDailyBars("BTC/EUR", "2026-11-19", "2026-11-23");
    expect(sleep).toHaveBeenCalled();
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(8000);
  });

  it("given the previous request started long enough ago, when another comes, then it does not wait", async () => {
    const { provider, sleep, advance } = setup();
    await provider.getDailyBars("EUR/USD", "2026-11-19", "2026-11-23");
    advance(8000);
    await provider.getDailyBars("BTC/EUR", "2026-11-19", "2026-11-23");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("given a custom minIntervalMs, when two requests follow, then they are spaced by at least that interval", async () => {
    let clock = 0;
    const starts: number[] = [];
    const fetch = vi.fn(async () => {
      starts.push(clock);
      return json(OK);
    });
    const provider = createTwelveDataProvider({
      apiKey: KEY,
      fetch: fetch as never,
      sleep: async (ms) => void (clock += ms),
      now: () => clock,
      minIntervalMs: 2500,
    });
    await provider.getDailyBars("A", "2026-11-19", "2026-11-23");
    await provider.getDailyBars("B", "2026-11-19", "2026-11-23");
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(2500);
    expect(starts[1] - starts[0]).toBeLessThan(8000);
  });
});
