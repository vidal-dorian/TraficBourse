// US #25 — the French text of get_watchlist agrees with `reasons`, and the threshold accepts a decimal comma.
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDatabase } from "../src/lib/db/client";
import { connectClient, dispatch, makeMigratedDatabase, MCP_TEST_TOKEN, type RouteModule } from "./helpers/mcp";

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
  vi.setSystemTime(new Date("2026-11-23T07:00:00Z"));
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function call(): Promise<{ text: string; threshold: number; moved: boolean }> {
  const route = (await import("../src/app/api/mcp/route")) as unknown as RouteModule;
  const client = await connectClient((request) => dispatch(route, request), MCP_TEST_TOKEN);
  clients.push(client);
  const result = await client.callTool({ name: "get_watchlist", arguments: { date: "2026-11-20" } });
  const content = result.content as { type: string; text?: string }[];
  const structured = result.structuredContent as { threshold: number; stocks: { moved: boolean }[] };
  return { text: content.map((item) => item.text ?? "").join("\n"), threshold: structured.threshold, moved: structured.stocks[0]?.moved ?? false };
}

function seed(earnings: string | null, closes: [string, number][]): void {
  const sqlite = openDatabase(databasePath);
  try {
    sqlite
      .prepare("INSERT INTO instruments (symbol, provider_symbol, name, type, currency, in_watchlist, last_earnings_date) VALUES ('AIR.PA', 'AIR.PA', 'Airbus', 'stock', 'EUR', 1, ?)")
      .run(earnings);
    for (const [date, close] of closes) sqlite.prepare("INSERT INTO prices_daily (symbol, date, close) VALUES ('AIR.PA', ?, ?)").run(date, close);
  } finally {
    sqlite.close();
  }
}

it("given results the day before and no close at all, when I read the text, then it says the stock moved", async () => {
  seed("2026-11-19", []);

  const { text, moved } = await call();

  expect(moved).toBe(true);
  expect(text).toContain("Pas encore de cours");
  expect(text).toContain("a bougé");
  expect(text).toContain("résultats publiés le 19/11");
  expect(text).not.toContain("n'a pas bougé");
});

it("given WATCHLIST_MOVE_THRESHOLD with a decimal comma, when I read a stock at +2.4 %, then 2,5 is the threshold and it did not move", async () => {
  vi.stubEnv("WATCHLIST_MOVE_THRESHOLD", "2,5");
  seed(null, [["2026-11-19", 100], ["2026-11-20", 102.4]]);

  const { threshold, moved } = await call();

  expect(threshold).toBe(2.5);
  expect(moved).toBe(false);
});
