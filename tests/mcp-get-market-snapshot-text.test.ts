// US #20 — text of get_market_snapshot for Claude: same notation as the Marchés page, old closes
// flagged, and a rejected call audited as failed. Time frozen at Monday 2026-11-23 08:00 in Paris.
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/lib/db/client";
import { connectClient, dispatch, makeMigratedDatabase, MCP_TEST_TOKEN, type RouteModule } from "./helpers/mcp";

let databasePath: string;
const clients: Client[] = [];

beforeEach(() => {
  databasePath = makeMigratedDatabase();
  vi.stubEnv("DATABASE_PATH", databasePath);
  vi.stubEnv("MCP_TOKEN", MCP_TEST_TOKEN);
  vi.stubEnv("TZ", "UTC");
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-23T07:00:00Z"));
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

async function textOf(client: Client, args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name: "get_market_snapshot", arguments: args });
  const content = (result.content ?? []) as { type: string; text?: string }[];
  return content.map((item) => item.text ?? "").join("\n");
}

function seed(symbol: string, closes: [string, number][]): void {
  const sqlite = openDatabase(databasePath);
  try {
    const insert = sqlite.prepare("INSERT INTO prices_daily (symbol, date, close) VALUES (?, ?, ?)");
    for (const [date, close] of closes) insert.run(symbol, date, close);
  } finally {
    sqlite.close();
  }
}

describe("get_market_snapshot — text for Claude", () => {
  it("given an index close, when I read the text, then the close is in the notation of the Marchés page and the variations are in French", async () => {
    seed("^FCHI", [
      ["2026-11-19", 297],
      ["2026-11-20", 300],
    ]);
    const text = await textOf(await connect(), { date: "2026-11-20" });
    expect(text).toContain("300,00 pts");
    expect(text).toContain("1 jour +1,01 %");
  });

  it("given a stale instrument, when I read the text, then it says « (cours ancien) »", async () => {
    seed("^GSPC", [["2026-11-10", 100]]);
    const text = await textOf(await connect(), { date: "2026-11-23" });
    expect(text).toContain("(cours ancien)");
  });

  it("given a fresh instrument only, when I read the text, then it does not say « (cours ancien) »", async () => {
    seed("^FCHI", [["2026-11-20", 300]]);
    const text = await textOf(await connect(), { date: "2026-11-23" });
    expect(text).not.toContain("(cours ancien)");
  });
});

describe("get_market_snapshot — audit of a rejected call", () => {
  it("given a valid call then an invalid one, when they finish, then the audit holds ok = 1 then ok = 0", async () => {
    const client = await connect();
    await client.callTool({ name: "get_market_snapshot", arguments: { date: "2026-11-20" } });
    await client.callTool({ name: "get_market_snapshot", arguments: { date: "demain" } }).catch(() => undefined);

    const sqlite = openDatabase(databasePath);
    try {
      const rows = sqlite.prepare("SELECT ok FROM mcp_audit WHERE tool = 'get_market_snapshot' ORDER BY rowid").all() as { ok: number }[];
      expect(rows.map((row) => row.ok)).toEqual([1, 0]);
    } finally {
      sqlite.close();
    }
  });
});
