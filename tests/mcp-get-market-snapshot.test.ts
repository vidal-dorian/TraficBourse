// US #20 — the Claude scheduled task reads the variations computed by the app through the
// `get_market_snapshot` MCP tool (criteria 78 and 79), to quote the same figures as the charts.
//
// Integration tests with the SDK client routed into the production route handler (tests/helpers/mcp.ts).
//
// Contract (CLAUDE.md §7, decisions of US #20):
// - The production registry serves a read-only tool `get_market_snapshot` taking `{ date? }`:
//   "YYYY-MM-DD", a real calendar date; optional, defaulting to today in Europe/Paris. Anything else
//   ("2026-13-01", "2026-02-30", "23/11/2026", 20261123) is an invalid-arguments error naming `date`.
// - Result: `structuredContent` = `{ date, instruments }` (`date` = the date asked or the Paris default),
//   one entry per instrument of the `instruments` table (ALL of them, watchlist or not), ordered by name,
//   each exactly:
//   `{ symbol, name, type, currency, lastClose, lastCloseDate, stale, variations: { day, week, month, ytd } }`.
//   - lastClose / lastCloseDate: latest close on or before `date` (closes after it are ignored).
//   - variations: percentages rounded to 2 decimals, definitions in tests/unit/market-snapshot.test.ts;
//     null when the reference close is missing. Instrument without any close: all null, stale false.
//   - stale: true when lastCloseDate is older than the last finished session before `date` (same rule as
//     src/lib/market/latest.ts: previous day for crypto, previous weekday otherwise).
// - A short French text for Claude is also returned: it names each instrument and, when it has a close,
//   the date of that close; it says « Pas encore de cours » for an instrument without close.
// - Every call is audited in `mcp_audit` (tool, ok).
//
// Time is frozen (only `Date`) at Monday 2026-11-23 08:00 in Paris.
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/lib/db/client";
import { connectClient, dispatch, makeMigratedDatabase, MCP_TEST_TOKEN, type RouteModule } from "./helpers/mcp";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

type Variations = { day: number | null; week: number | null; month: number | null; ytd: number | null };
type SnapshotEntry = {
  symbol: string;
  name: string;
  type: string;
  currency: string;
  lastClose: number | null;
  lastCloseDate: string | null;
  stale: boolean;
  variations: Variations;
};
type Snapshot = { date: string; instruments: SnapshotEntry[] };

const NOW = "2026-11-23T07:00:00Z";

let databasePath: string;
const clients: Client[] = [];

beforeEach(() => {
  databasePath = makeMigratedDatabase();
  vi.stubEnv("DATABASE_PATH", databasePath);
  vi.stubEnv("MCP_TOKEN", MCP_TEST_TOKEN);
  vi.stubEnv("TZ", "UTC");
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

function getSnapshot(client: Client, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return client.callTool({ name: "get_market_snapshot", arguments: args });
}

function resultText(result: ToolResult): string {
  const content = (result.content ?? []) as { type: string; text?: string }[];
  return content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");
}

function snapshotOf(result: ToolResult): Snapshot {
  expect(result.isError, `get_market_snapshot failed:\n${resultText(result)}`).not.toBe(true);
  return result.structuredContent as Snapshot;
}

function entryOf(snapshot: Snapshot, symbol: string): SnapshotEntry {
  const found = snapshot.instruments.find((candidate) => candidate.symbol === symbol);
  expect(found, `${symbol} must be in the snapshot`).toBeDefined();
  return found as SnapshotEntry;
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

function readAudit(): { tool: string; ok: number }[] {
  const sqlite = openDatabase(databasePath);
  try {
    return sqlite.prepare("SELECT tool, ok FROM mcp_audit ORDER BY rowid").all() as { tool: string; ok: number }[];
  } finally {
    sqlite.close();
  }
}

/** CAC 40, asked on Friday 2026-11-20 (same fixture as tests/unit/market-snapshot.test.ts). */
const CAC_CLOSES: [string, number][] = [
  ["2025-12-30", 100],
  ["2025-12-31", 200],
  ["2026-01-02", 210],
  ["2026-10-19", 240],
  ["2026-10-21", 280],
  ["2026-11-13", 270],
  ["2026-11-19", 297],
  ["2026-11-20", 300],
  ["2026-11-23", 999],
];

describe("criterion 78 — get_market_snapshot gives, for each instrument, the last close and the 1D, 1W, 1M and YTD variations", () => {
  it("given the MCP endpoint, when Claude lists the tools, then get_market_snapshot is listed with an optional date argument", async () => {
    const client = await connect();

    const { tools } = await client.listTools();

    const tool = tools.find((candidate) => candidate.name === "get_market_snapshot");
    expect(tool, `tools listed: ${tools.map((candidate) => candidate.name).join(", ")}`).toBeDefined();
    expect(tool?.description?.trim().length).toBeGreaterThan(0);
    const schema = tool?.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
    expect(Object.keys(schema.properties ?? {})).toEqual(["date"]);
    expect(schema.required ?? []).not.toContain("date");
    expect(tool?.annotations?.readOnlyHint).toBe(true);
  });

  it("given closes in the database, when I call get_market_snapshot with a date, then the CAC 40 entry has its last close and its 1D, 1W, 1M and YTD variations", async () => {
    seedCloses("^FCHI", CAC_CLOSES);
    const client = await connect();

    const snapshot = snapshotOf(await getSnapshot(client, { date: "2026-11-20" }));

    expect(snapshot.date).toBe("2026-11-20");
    expect(entryOf(snapshot, "^FCHI")).toEqual({
      symbol: "^FCHI",
      name: "CAC 40",
      type: "index",
      currency: "EUR",
      lastClose: 300,
      lastCloseDate: "2026-11-20",
      stale: false,
      variations: { day: 1.01, week: 11.11, month: 25, ytd: 50 },
    });
  });

  it("given a date earlier than the latest stored close, when I call it, then closes after that date are ignored", async () => {
    seedCloses("^FCHI", CAC_CLOSES);
    const client = await connect();

    const asked = entryOf(snapshotOf(await getSnapshot(client, { date: "2026-11-20" })), "^FCHI");
    const later = entryOf(snapshotOf(await getSnapshot(client, { date: "2026-11-23" })), "^FCHI");

    expect(asked.lastClose).toBe(300);
    expect(later.lastClose).toBe(999);
    expect(later.lastCloseDate).toBe("2026-11-23");
  });

  it("given no date, when I call get_market_snapshot, then it defaults to today in Europe/Paris", async () => {
    seedCloses("^FCHI", CAC_CLOSES);
    const client = await connect();

    const snapshot = snapshotOf(await getSnapshot(client));

    expect(snapshot.date).toBe("2026-11-23");
    expect(entryOf(snapshot, "^FCHI").lastClose).toBe(999);
  });

  it("given the default instruments, when I call it, then every instrument is listed (watchlist or not), ordered by name, with exactly the contract fields", async () => {
    const client = await connect();

    const snapshot = snapshotOf(await getSnapshot(client, { date: "2026-11-20" }));

    expect(snapshot.instruments).toHaveLength(9);
    const names = snapshot.instruments.map((entry) => entry.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    for (const entry of snapshot.instruments) {
      expect(Object.keys(entry).sort()).toEqual(
        ["currency", "lastClose", "lastCloseDate", "name", "stale", "symbol", "type", "variations"].sort(),
      );
      expect(Object.keys(entry.variations).sort()).toEqual(["day", "month", "week", "ytd"]);
    }
  });

  it("given an instrument without any price, when I call it, then its last close, date and variations are null and it is not stale", async () => {
    const client = await connect();

    const snapshot = snapshotOf(await getSnapshot(client, { date: "2026-11-20" }));

    expect(entryOf(snapshot, "GC=F")).toMatchObject({
      lastClose: null,
      lastCloseDate: null,
      stale: false,
      variations: { day: null, week: null, month: null, ytd: null },
    });
  });

  it("given a reference close is missing, when I call it, then only that variation is null", async () => {
    seedCloses("^GSPC", [
      ["2026-11-19", 297],
      ["2026-11-20", 300],
    ]);
    const client = await connect();

    const snapshot = snapshotOf(await getSnapshot(client, { date: "2026-11-20" }));

    expect(entryOf(snapshot, "^GSPC").variations).toEqual({ day: 1.01, week: null, month: null, ytd: null });
  });

  it("given closes, when I call it, then the text for Claude names the instruments and the date of their last close", async () => {
    seedCloses("^FCHI", CAC_CLOSES);
    const client = await connect();

    const text = resultText(await getSnapshot(client, { date: "2026-11-20" }));

    expect(text).toContain("CAC 40");
    expect(text).toContain("2026-11-20");
    expect(text).toContain("Pas encore de cours");
  });
});

describe("criterion 79 — an instrument whose last close is old shows the date of its last close", () => {
  it("given an instrument whose last close is 13 days old, when I read the snapshot, then its last close date is given and it is stale", async () => {
    seedCloses("^GSPC", [
      ["2026-11-09", 100],
      ["2026-11-10", 102],
    ]);
    const client = await connect();

    const snapshot = snapshotOf(await getSnapshot(client));

    expect(entryOf(snapshot, "^GSPC")).toMatchObject({
      lastClose: 102,
      lastCloseDate: "2026-11-10",
      stale: true,
      variations: { day: 2 },
    });
    expect(resultText(await getSnapshot(client))).toContain("2026-11-10");
  });

  it("given a fresh and an old instrument, when I read the snapshot on a Monday, then Friday's close is fresh and Thursday's is stale", async () => {
    seedCloses("^FCHI", [["2026-11-20", 300]]);
    seedCloses("^GSPC", [["2026-11-19", 300]]);
    const client = await connect();

    const snapshot = snapshotOf(await getSnapshot(client, { date: "2026-11-23" }));

    expect(entryOf(snapshot, "^FCHI")).toMatchObject({ lastCloseDate: "2026-11-20", stale: false });
    expect(entryOf(snapshot, "^GSPC")).toMatchObject({ lastCloseDate: "2026-11-19", stale: true });
  });

  it("given a crypto whose last close is two days old, when I read the snapshot, then it is stale; yesterday's is fresh", async () => {
    seedCloses("BTC-EUR", [["2026-11-21", 90000]]);
    const client = await connect();

    const snapshot = snapshotOf(await getSnapshot(client, { date: "2026-11-23" }));
    expect(entryOf(snapshot, "BTC-EUR")).toMatchObject({ lastCloseDate: "2026-11-21", stale: true });

    seedCloses("BTC-EUR", [["2026-11-22", 91000]]);
    const fresh = snapshotOf(await getSnapshot(client, { date: "2026-11-23" }));
    expect(entryOf(fresh, "BTC-EUR")).toMatchObject({ lastCloseDate: "2026-11-22", stale: false });
  });
});

describe("get_market_snapshot — arguments and audit", () => {
  it.each([
    ["an impossible month", "2026-13-01"],
    ["an impossible day", "2026-02-30"],
    ["a French format", "23/11/2026"],
    ["a text", "demain"],
    ["a number", 20261123],
  ])("given date is %s, when I call get_market_snapshot, then it is an invalid-arguments error naming date", async (_label, date) => {
    const client = await connect();

    const result = await getSnapshot(client, { date }).catch((error: unknown) => ({
      isError: true,
      content: [{ type: "text", text: String(error) }],
    }));

    expect(result.isError).toBe(true);
    expect(resultText(result as ToolResult)).toMatch(/date/i);
  });

  it("given a successful call and a rejected one, when they finish, then each is audited in mcp_audit under get_market_snapshot", async () => {
    const client = await connect();

    await getSnapshot(client, { date: "2026-11-20" });
    await getSnapshot(client, { date: "demain" }).catch(() => undefined);

    const rows = readAudit().filter((row) => row.tool === "get_market_snapshot");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.ok).toBe(1);
  });
});
