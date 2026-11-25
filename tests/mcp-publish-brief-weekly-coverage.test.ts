// US #29 — the weekly recap covers every followed stock (criteria 1 and 2).
//
// Contract (`src/lib/mcp/tools/publish-brief.ts`, CLAUDE.md §7):
// - `kind = "weekly"`: every instrument with `in_watchlist` = 1 must have a note in
//   `payload.stockNotes`. Otherwise an `isError` result lists the missing symbols (each named),
//   dry run included, before any write, merged with the other refusals.
// - a daily brief has no such rule; an empty watchlist requires nothing.
// - a daily and a weekly brief of the same date coexist (unique on date + kind).
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { otherValidPayload, validPayload, type Json, type JsonObject } from "./fixtures/brief-payloads";
import { countBriefRows, readBriefs, readNewsItems, readStockNotes, seedStocks } from "./helpers/briefs";
import { connectClient, dispatch, makeMigratedDatabase, MCP_TEST_TOKEN, type RouteModule } from "./helpers/mcp";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

const DATE = "2026-11-21";

let databasePath: string;
const clients: Client[] = [];

async function setup(stocks: { symbol: string; name: string; inWatchlist?: boolean }[]): Promise<void> {
  databasePath = makeMigratedDatabase();
  await seedStocks(databasePath, stocks);
  vi.stubEnv("DATABASE_PATH", databasePath);
  vi.stubEnv("MCP_TOKEN", MCP_TEST_TOKEN);
  vi.resetModules();
}

const THREE_STOCKS = [
  { symbol: "AI.PA", name: "Air Liquide" },
  { symbol: "MC.PA", name: "LVMH" },
  { symbol: "SAN.PA", name: "Sanofi" },
  { symbol: "OR.PA", name: "L'Oréal", inWatchlist: false },
];

beforeEach(async () => {
  await setup(THREE_STOCKS);
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function connect(): Promise<Client> {
  const route = (await import("../src/app/api/mcp/route")) as unknown as RouteModule;
  const client = await connectClient((request) => dispatch(route, request), MCP_TEST_TOKEN);
  clients.push(client);
  return client;
}

function publish(client: Client, args: Record<string, Json | undefined>): Promise<ToolResult> {
  return client.callTool({ name: "publish_brief", arguments: args });
}

function resultText(result: ToolResult): string {
  const content = (result.content ?? []) as { type: string; text?: string }[];
  return content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");
}

function note(symbol: string, reason = "weekly"): JsonObject {
  return { symbol, reason, summary: `Fiche de la semaine pour ${symbol}.` };
}

function weeklyPayload(...symbols: string[]): JsonObject {
  return { ...validPayload(), stockNotes: symbols.map((s) => note(s)) };
}

describe("US #29 criterion 1 — given a weekly payload that does not cover the watchlist, when Claude publishes, then the tool refuses listing the missing symbols", () => {
  it.each([true, false])(
    "given a weekly with a note for one stock out of three, when Claude publishes (dry_run %s), then it refuses naming both missing symbols and writes nothing",
    async (dryRun) => {
      const client = await connect();

      const result = await publish(client, { date: DATE, kind: "weekly", payload: weeklyPayload("AI.PA"), dry_run: dryRun });

      expect(result.isError, resultText(result)).toBe(true);
      const text = resultText(result);
      expect(text).toContain("MC.PA");
      expect(text).toContain("SAN.PA");
      expect(text, "a covered stock is not listed as missing").not.toContain("AI.PA");
      expect(text, "a stock outside the watchlist is not required").not.toContain("OR.PA");
      expect(text).toMatch(/payload\.stockNotes\s*:/);
      expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
      expect(readStockNotes(databasePath)).toEqual([]);
    },
  );

  it("given a weekly without any stockNotes, when Claude publishes, then it refuses naming every followed stock", async () => {
    const client = await connect();
    const result = await publish(client, { date: DATE, kind: "weekly", payload: validPayload() });
    expect(result.isError, resultText(result)).toBe(true);
    const text = resultText(result);
    for (const symbol of ["AI.PA", "MC.PA", "SAN.PA"]) expect(text).toContain(symbol);
    expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
  });

  it("given two notes for the same stock, when Claude publishes a weekly, then the stocks without a note are still refused", async () => {
    const client = await connect();
    const result = await publish(client, { date: DATE, kind: "weekly", payload: weeklyPayload("AI.PA", "AI.PA", "MC.PA") });
    expect(result.isError, resultText(result)).toBe(true);
    expect(resultText(result)).toContain("SAN.PA");
    expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
  });

  it("given a weekly with an unknown symbol and a missing one, when Claude publishes, then both problems are reported in one answer", async () => {
    const client = await connect();
    const result = await publish(client, { date: DATE, kind: "weekly", payload: weeklyPayload("AI.PA", "MC.PA", "ZZZ.PA") });
    expect(result.isError, resultText(result)).toBe(true);
    const text = resultText(result);
    expect(text).toMatch(/payload\.stockNotes\.2\.symbol\s*:/);
    expect(text).toContain("ZZZ.PA");
    expect(text).toContain("SAN.PA");
  });

  it("given a published weekly, when a republication leaves a stock out, then it is refused and the published recap stays untouched", async () => {
    const client = await connect();
    const first = await publish(client, { date: DATE, kind: "weekly", payload: weeklyPayload("AI.PA", "MC.PA", "SAN.PA") });
    expect(first.isError, resultText(first)).not.toBe(true);
    const before = { briefs: readBriefs(databasePath), news: readNewsItems(databasePath), notes: readStockNotes(databasePath) };

    const result = await publish(client, { date: DATE, kind: "weekly", payload: { ...otherValidPayload(), stockNotes: [note("AI.PA")] } });

    expect(result.isError).toBe(true);
    expect(readBriefs(databasePath)).toEqual(before.briefs);
    expect(readNewsItems(databasePath)).toEqual(before.news);
    expect(readStockNotes(databasePath)).toEqual(before.notes);
  });

  it("given a weekly that covers the whole watchlist, when Claude publishes, then it is accepted with one note per stock", async () => {
    const client = await connect();
    const result = await publish(client, { date: DATE, kind: "weekly", payload: weeklyPayload("SAN.PA", "AI.PA", "MC.PA") });
    expect(result.isError, resultText(result)).not.toBe(true);
    expect(readStockNotes(databasePath).map((n) => n.symbol).sort()).toEqual(["AI.PA", "MC.PA", "SAN.PA"]);
  });

  it("given a weekly that covers the watchlist with any reason, when Claude publishes, then the reason does not matter", async () => {
    const client = await connect();
    const payload = { ...validPayload(), stockNotes: [note("AI.PA", "earnings"), note("MC.PA", "move"), note("SAN.PA", "news")] };
    const result = await publish(client, { date: DATE, kind: "weekly", payload });
    expect(result.isError, resultText(result)).not.toBe(true);
  });

  it("given a daily brief that does not cover the watchlist, when Claude publishes, then it is accepted: the rule is for the recap only", async () => {
    const client = await connect();
    const result = await publish(client, { date: DATE, kind: "daily", payload: weeklyPayload("AI.PA") });
    expect(result.isError, resultText(result)).not.toBe(true);
  });

  it("given an empty watchlist, when Claude publishes a weekly without notes, then it is accepted", async () => {
    await setup([{ symbol: "OR.PA", name: "L'Oréal", inWatchlist: false }]);
    const client = await connect();
    const result = await publish(client, { date: DATE, kind: "weekly", payload: validPayload() });
    expect(result.isError, resultText(result)).not.toBe(true);
    expect(countBriefRows(databasePath).briefs).toBe(1);
  });
});

describe("US #29 criterion 2 — given a complete recap, when Claude publishes, then it coexists with a daily brief of the same date", () => {
  it("given a daily brief of Saturday, when Claude publishes the complete weekly of the same date, then both rows exist", async () => {
    const client = await connect();
    const daily = await publish(client, { date: DATE, kind: "daily", payload: otherValidPayload() });
    expect(daily.isError, resultText(daily)).not.toBe(true);

    const weekly = await publish(client, { date: DATE, kind: "weekly", payload: weeklyPayload("AI.PA", "MC.PA", "SAN.PA") });

    expect(weekly.isError, resultText(weekly)).not.toBe(true);
    const briefs = readBriefs(databasePath);
    expect(briefs.map((b) => `${b.date}/${b.kind}`).sort()).toEqual([`${DATE}/daily`, `${DATE}/weekly`]);
  });

  it("given both briefs, when Claude republishes the weekly, then the daily brief and its news are untouched and the weekly stays unique", async () => {
    const client = await connect();
    await publish(client, { date: DATE, kind: "daily", payload: otherValidPayload() });
    await publish(client, { date: DATE, kind: "weekly", payload: weeklyPayload("AI.PA", "MC.PA", "SAN.PA") });
    const daily = readBriefs(databasePath).find((b) => b.kind === "daily")!;
    const dailyNews = readNewsItems(databasePath).filter((n) => n.brief_id === daily.id);

    const again = await publish(client, { date: DATE, kind: "weekly", payload: { ...otherValidPayload(), stockNotes: ["SAN.PA", "AI.PA", "MC.PA"].map((s) => note(s)) } });

    expect(again.isError, resultText(again)).not.toBe(true);
    const briefs = readBriefs(databasePath);
    expect(briefs.filter((b) => b.kind === "weekly")).toHaveLength(1);
    expect(briefs.find((b) => b.kind === "daily")).toEqual(daily);
    expect(readNewsItems(databasePath).filter((n) => n.brief_id === daily.id)).toEqual(dailyNews);
    expect(readStockNotes(databasePath)).toHaveLength(3);
  });

  it("given an incomplete weekly refused, when a daily of the same date already exists, then the daily stays published", async () => {
    const client = await connect();
    await publish(client, { date: DATE, kind: "daily", payload: otherValidPayload() });
    const refused = await publish(client, { date: DATE, kind: "weekly", payload: weeklyPayload("AI.PA") });
    expect(refused.isError).toBe(true);
    expect(readBriefs(databasePath).map((b) => b.kind)).toEqual(["daily"]);
  });
});
