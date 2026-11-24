// US #25 — the Claude scheduled task learns which watchlist stocks moved through the `get_watchlist`
// MCP tool (criteria 93 to 96), to write a note only for those.
//
// Contract (CLAUDE.md §7, decisions of US #25):
// - Read-only tool `get_watchlist` taking `{ date? }` (same validation as get_market_snapshot).
// - `structuredContent` = `{ date, threshold, stocks }`; `stocks` = instruments with in_watchlist = true only,
//   sorted by name (fr), each exactly `{ symbol, name, type, currency, lastClose, lastCloseDate, stale,
//   variations: { day, week }, lastEarningsDate, moved, reasons }`.
// - reasons is a subset, in order, of ["move", "earnings"]; moved = reasons.length > 0.
// - move: |day| >= threshold (inclusive), day null -> no move. Threshold = env WATCHLIST_MOVE_THRESHOLD
//   (positive percent), default 2 when absent or invalid; echoed in `threshold`.
// - earnings: instruments.last_earnings_date on or after the previous weekday before `date` and strictly
//   before `date`.
//
// Time is frozen (only `Date`) at Monday 2026-11-23 08:00 in Paris.
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/lib/db/client";
import { connectClient, dispatch, makeMigratedDatabase, MCP_TEST_TOKEN, type RouteModule } from "./helpers/mcp";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

type Entry = {
  symbol: string;
  name: string;
  type: string;
  currency: string;
  lastClose: number | null;
  lastCloseDate: string | null;
  stale: boolean;
  variations: { day: number | null; week: number | null };
  lastEarningsDate: string | null;
  moved: boolean;
  reasons: string[];
};
type Watchlist = { date: string; threshold: number; stocks: Entry[] };

const NOW = "2026-11-23T07:00:00Z";

let databasePath: string;
const clients: Client[] = [];

beforeEach(() => {
  databasePath = makeMigratedDatabase();
  vi.stubEnv("DATABASE_PATH", databasePath);
  vi.stubEnv("MCP_TOKEN", MCP_TEST_TOKEN);
  vi.stubEnv("TZ", "UTC");
  vi.stubEnv("WATCHLIST_MOVE_THRESHOLD", "");
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function connect(): Promise<Client> {
  const route = (await import("../src/app/api/mcp/route")) as unknown as RouteModule;
  const client = await connectClient((request) => dispatch(route, request), MCP_TEST_TOKEN);
  clients.push(client);
  return client;
}

function getWatchlist(client: Client, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return client.callTool({ name: "get_watchlist", arguments: args });
}

function resultText(result: ToolResult): string {
  const content = (result.content ?? []) as { type: string; text?: string }[];
  return content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");
}

function watchlistOf(result: ToolResult): Watchlist {
  expect(result.isError, `get_watchlist failed:\n${resultText(result)}`).not.toBe(true);
  return result.structuredContent as Watchlist;
}

function entryOf(list: Watchlist, symbol: string): Entry {
  const found = list.stocks.find((candidate) => candidate.symbol === symbol);
  expect(found, `${symbol} must be in the watchlist`).toBeDefined();
  return found as Entry;
}

interface StockSeed {
  symbol: string;
  name?: string;
  type?: string;
  inWatchlist?: boolean;
  lastEarningsDate?: string | null;
}

function seedStock(seed: StockSeed): void {
  const sqlite = openDatabase(databasePath);
  try {
    sqlite
      .prepare(
        "INSERT INTO instruments (symbol, provider_symbol, name, type, currency, in_watchlist) VALUES (?, ?, ?, ?, 'EUR', ?)",
      )
      .run(seed.symbol, seed.symbol, seed.name ?? seed.symbol, seed.type ?? "stock", seed.inWatchlist === false ? 0 : 1);
    if (seed.lastEarningsDate !== undefined) {
      sqlite.prepare("UPDATE instruments SET last_earnings_date = ? WHERE symbol = ?").run(seed.lastEarningsDate, seed.symbol);
    }
  } finally {
    sqlite.close();
  }
}

function seedCloses(symbol: string, closes: [string, number][]): void {
  const sqlite = openDatabase(databasePath);
  try {
    const insert = sqlite.prepare("INSERT INTO prices_daily (symbol, date, close) VALUES (?, ?, ?)");
    for (const [date, close] of closes) insert.run(symbol, date, close);
  } finally {
    sqlite.close();
  }
}

/** A stock whose close of Friday 2026-11-20 is `last`, after 100 the day before and 100 a week before. */
function seedMover(symbol: string, last: number, extra: Partial<StockSeed> = {}): void {
  seedStock({ symbol, ...extra });
  seedCloses(symbol, [
    ["2026-11-13", 100],
    ["2026-11-19", 100],
    ["2026-11-20", last],
  ]);
}

const ASK = { date: "2026-11-20" };

describe("criterion 93 — get_watchlist gives each stock with its last close, day and week variations", () => {
  it("given the MCP endpoint, when Claude lists the tools, then get_watchlist is listed, read-only, with an optional date", async () => {
    const client = await connect();

    const { tools } = await client.listTools();

    const tool = tools.find((candidate) => candidate.name === "get_watchlist");
    expect(tool, `tools listed: ${tools.map((candidate) => candidate.name).join(", ")}`).toBeDefined();
    expect(tool?.description?.trim().length).toBeGreaterThan(0);
    const schema = tool?.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
    expect(Object.keys(schema.properties ?? {})).toEqual(["date"]);
    expect(schema.required ?? []).not.toContain("date");
    expect(tool?.annotations?.readOnlyHint).toBe(true);
  });

  it("given a watchlist stock with closes, when I call get_watchlist, then it has exactly the contract fields with last close, day and week variations", async () => {
    seedMover("AIR.PA", 102.4, { name: "Airbus" });
    const client = await connect();

    const list = watchlistOf(await getWatchlist(client, ASK));

    expect(list.date).toBe("2026-11-20");
    expect(list.threshold).toBe(2);
    expect(list.stocks).toHaveLength(1);
    expect(list.stocks[0]).toEqual({
      symbol: "AIR.PA",
      name: "Airbus",
      type: "stock",
      currency: "EUR",
      lastClose: 102.4,
      lastCloseDate: "2026-11-20",
      stale: false,
      variations: { day: 2.4, week: 2.4 },
      lastEarningsDate: null,
      moved: true,
      reasons: ["move"],
    });
  });

  it("given a mix of instruments, when I call it, then only watchlist ones are listed (stock or ETF), sorted by name", async () => {
    seedMover("TTE.PA", 100, { name: "TotalEnergies" });
    seedMover("AIR.PA", 100, { name: "Airbus" });
    seedMover("CW8.PA", 100, { name: "Amundi MSCI World", type: "etf" });
    seedStock({ symbol: "ZZZ", name: "Hors liste", inWatchlist: false });
    const client = await connect();

    const list = watchlistOf(await getWatchlist(client, ASK));

    expect(list.stocks.map((entry) => entry.symbol)).toEqual(["AIR.PA", "CW8.PA", "TTE.PA"]);
    expect(entryOf(list, "CW8.PA").type).toBe("etf");
  });

  it("given a stock without any close, when I call it, then its close and variations are null, it did not move, and the text says « Pas encore de cours »", async () => {
    seedStock({ symbol: "AIR.PA", name: "Airbus" });
    const client = await connect();

    const result = await getWatchlist(client, ASK);
    const list = watchlistOf(result);

    expect(entryOf(list, "AIR.PA")).toMatchObject({
      lastClose: null,
      lastCloseDate: null,
      stale: false,
      variations: { day: null, week: null },
      moved: false,
      reasons: [],
    });
    expect(resultText(result)).toContain("Pas encore de cours");
  });

  it("given a stale stock and a date later than the latest close, when I call it, then closes after the date are ignored and stale is set from the last session", async () => {
    seedStock({ symbol: "AIR.PA", name: "Airbus" });
    seedCloses("AIR.PA", [
      ["2026-11-19", 100],
      ["2026-11-20", 101],
      ["2026-11-23", 999],
    ]);
    const client = await connect();

    const onFriday = entryOf(watchlistOf(await getWatchlist(client, { date: "2026-11-20" })), "AIR.PA");
    expect(onFriday.lastClose).toBe(101);

    seedStock({ symbol: "OLD", name: "Old" });
    seedCloses("OLD", [["2026-11-19", 100]]);
    const onMonday = watchlistOf(await getWatchlist(client, { date: "2026-11-23" }));
    expect(entryOf(onMonday, "OLD")).toMatchObject({ lastCloseDate: "2026-11-19", stale: true });
  });

  it("given no date, when I call get_watchlist, then it defaults to today in Europe/Paris", async () => {
    seedStock({ symbol: "AIR.PA", name: "Airbus" });
    seedCloses("AIR.PA", [["2026-11-20", 100]]);
    const client = await connect();

    const list = watchlistOf(await getWatchlist(client));

    expect(list.date).toBe("2026-11-23");
  });

  it("given closes, when I call it, then the text names each stock with symbol, close and variations", async () => {
    seedMover("AIR.PA", 102.4, { name: "Airbus" });
    const client = await connect();

    const text = resultText(await getWatchlist(client, ASK));

    expect(text).toContain("Airbus");
    expect(text).toContain("AIR.PA");
    expect(text).toMatch(/a bougé/);
  });

  it("given an empty watchlist, when I call it, then stocks is empty and the French text says the watchlist is empty", async () => {
    const client = await connect();

    const result = await getWatchlist(client, ASK);

    expect(watchlistOf(result).stocks).toEqual([]);
    expect(resultText(result).toLowerCase()).toContain("watchlist");
    expect(resultText(result).toLowerCase()).toMatch(/vide|aucune/);
  });

  it.each([
    ["an impossible month", "2026-13-01"],
    ["an impossible day", "2026-02-30"],
    ["a French format", "23/11/2026"],
    ["a number", 20261123],
  ])("given date is %s, when I call get_watchlist, then it is an invalid-arguments error naming date", async (_label, date) => {
    const client = await connect();

    const result = await getWatchlist(client, { date }).catch((error: unknown) => ({
      isError: true,
      content: [{ type: "text", text: String(error) }],
    }));

    expect(result.isError).toBe(true);
    expect(resultText(result as ToolResult)).toMatch(/date/i);
  });

  it("given an unknown argument, when I call get_watchlist, then it is rejected", async () => {
    const client = await connect();
    watchlistOf(await getWatchlist(client, ASK));

    const result = await getWatchlist(client, { symbols: ["AIR.PA"] }).catch((error: unknown) => ({
      isError: true,
      content: [{ type: "text", text: String(error) }],
    }));

    expect(result.isError).toBe(true);
  });
});

describe("criterion 94 — a stock at +2.4 % on the day has moved, reason move", () => {
  it("given a stock at +2.4 % on the day, when I read the watchlist, then moved is true with reason move", async () => {
    seedMover("AIR.PA", 102.4);
    const client = await connect();

    const stock = entryOf(watchlistOf(await getWatchlist(client, ASK)), "AIR.PA");

    expect(stock.variations.day).toBe(2.4);
    expect(stock.moved).toBe(true);
    expect(stock.reasons).toEqual(["move"]);
  });

  it("given a stock at -2.0 % on the day, when I read the watchlist, then the threshold is inclusive: moved with reason move", async () => {
    seedMover("AIR.PA", 98);
    const client = await connect();

    const stock = entryOf(watchlistOf(await getWatchlist(client, ASK)), "AIR.PA");

    expect(stock.variations.day).toBe(-2);
    expect(stock).toMatchObject({ moved: true, reasons: ["move"] });
  });

  it("given a stock without a day variation (single close), when I read the watchlist, then it has not moved", async () => {
    seedStock({ symbol: "AIR.PA" });
    seedCloses("AIR.PA", [["2026-11-20", 100]]);
    const client = await connect();

    const stock = entryOf(watchlistOf(await getWatchlist(client, ASK)), "AIR.PA");

    expect(stock.variations.day).toBeNull();
    expect(stock).toMatchObject({ moved: false, reasons: [] });
  });

  it("given WATCHLIST_MOVE_THRESHOLD=3, when I read a stock at +2.4 %, then it has not moved and the threshold is echoed", async () => {
    vi.stubEnv("WATCHLIST_MOVE_THRESHOLD", "3");
    seedMover("AIR.PA", 102.4);
    const client = await connect();

    const list = watchlistOf(await getWatchlist(client, ASK));

    expect(list.threshold).toBe(3);
    expect(entryOf(list, "AIR.PA")).toMatchObject({ moved: false, reasons: [] });
  });

  it("given WATCHLIST_MOVE_THRESHOLD=1, when I read a stock at -1.1 %, then it has moved", async () => {
    vi.stubEnv("WATCHLIST_MOVE_THRESHOLD", "1");
    seedMover("AIR.PA", 98.9);
    const client = await connect();

    const list = watchlistOf(await getWatchlist(client, ASK));

    expect(list.threshold).toBe(1);
    expect(entryOf(list, "AIR.PA")).toMatchObject({ moved: true, reasons: ["move"] });
  });

  it.each(["abc", "0", "-2", "NaN"])(
    "given an invalid WATCHLIST_MOVE_THRESHOLD (%s), when I read the watchlist, then the default threshold 2 is used",
    async (value) => {
      vi.stubEnv("WATCHLIST_MOVE_THRESHOLD", value);
      seedMover("AIR.PA", 102.4);
      const client = await connect();

      const list = watchlistOf(await getWatchlist(client, ASK));

      expect(list.threshold).toBe(2);
      expect(entryOf(list, "AIR.PA").moved).toBe(true);
    },
  );
});

describe("criterion 95 — a stock at -1.1 % with no published results has not moved", () => {
  it("given a stock at -1.1 % and no earnings date, when I read the watchlist, then moved is false and reasons is empty", async () => {
    seedMover("AIR.PA", 98.9);
    const client = await connect();

    const result = await getWatchlist(client, ASK);
    const stock = entryOf(watchlistOf(result), "AIR.PA");

    expect(stock.variations.day).toBe(-1.1);
    expect(stock).toMatchObject({ moved: false, reasons: [] });
    expect(resultText(result)).toContain("n'a pas bougé");
  });
});

describe("criterion 96 — results published the day before make the stock move, reason earnings", () => {
  it("given an earnings date equal to the day before, when I read the watchlist, then moved is true with reason earnings", async () => {
    seedMover("AIR.PA", 98.9, { lastEarningsDate: "2026-11-19" });
    const client = await connect();

    const result = await getWatchlist(client, ASK);
    const stock = entryOf(watchlistOf(result), "AIR.PA");

    expect(stock.lastEarningsDate).toBe("2026-11-19");
    expect(stock).toMatchObject({ moved: true, reasons: ["earnings"] });
    expect(resultText(result)).toContain("résultats publiés le 19/11");
  });

  it("given a big move and results the day before, when I read the watchlist, then reasons are move then earnings", async () => {
    seedMover("AIR.PA", 102.4, { lastEarningsDate: "2026-11-19" });
    const client = await connect();

    const stock = entryOf(watchlistOf(await getWatchlist(client, ASK)), "AIR.PA");

    expect(stock).toMatchObject({ moved: true, reasons: ["move", "earnings"] });
  });

  it.each([
    ["two days before", "2026-11-18"],
    ["the date itself", "2026-11-20"],
    ["a later date", "2026-11-21"],
  ])("given an earnings date %s, when I read the watchlist, then there is no earnings reason", async (_label, earnings) => {
    seedMover("AIR.PA", 98.9, { lastEarningsDate: earnings });
    const client = await connect();

    const stock = entryOf(watchlistOf(await getWatchlist(client, ASK)), "AIR.PA");

    expect(stock).toMatchObject({ moved: false, reasons: [], lastEarningsDate: earnings });
  });

  it.each([
    ["Friday", "2026-11-20", true],
    ["Saturday", "2026-11-21", true],
    ["Sunday", "2026-11-22", true],
    ["Thursday", "2026-11-19", false],
    ["the Monday itself", "2026-11-23", false],
  ])("given the date is a Monday and results were published on %s, when I read the watchlist, then earnings is %s", async (_label, earnings, expected) => {
    seedStock({ symbol: "AIR.PA", lastEarningsDate: earnings });
    seedCloses("AIR.PA", [
      ["2026-11-19", 100],
      ["2026-11-20", 100],
    ]);
    const client = await connect();

    const stock = entryOf(watchlistOf(await getWatchlist(client, { date: "2026-11-23" })), "AIR.PA");

    expect(stock.reasons.includes("earnings")).toBe(expected);
  });
});

describe("get_watchlist — audit", () => {
  it("given a call, when it finishes, then it is audited in mcp_audit under get_watchlist", async () => {
    const client = await connect();

    await getWatchlist(client, ASK);

    const sqlite = openDatabase(databasePath);
    try {
      const rows = sqlite.prepare("SELECT tool, ok FROM mcp_audit WHERE tool = 'get_watchlist'").all() as { ok: number }[];
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]?.ok).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});
