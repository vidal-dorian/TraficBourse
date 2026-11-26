// US #26 — Claude publishes per-stock notes (#97) and cannot publish one for a symbol outside the
// watchlist (#98).
//
// Contract (`src/lib/mcp/tools/publish-brief.ts`, `src/lib/briefs/publish.ts`):
// - `payload.stockNotes` (see CLAUDE.md §7) is stored in the new table `stock_notes` (brief_id,
//   symbol, reason, summary, news_refs JSON array, next_event nullable), in the same transaction as
//   the news items, in payload order. Republishing replaces the notes of that brief.
// - every note symbol must be an instrument with `in_watchlist` = 1. Otherwise an `isError`
//   result with one `payload.stockNotes.N.symbol : …` line per offending note, naming the symbol,
//   with dry_run true or false and before any write.
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { otherValidPayload, validPayload, type Json, type JsonObject } from "./fixtures/brief-payloads";
import { countBriefRows, readBriefs, readNewsItems, readStockNotes, seedStocks } from "./helpers/briefs";
import { connectClient, dispatch, makeMigratedDatabase, MCP_TEST_TOKEN, type RouteModule } from "./helpers/mcp";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

const DATE = "2026-11-20";

let databasePath: string;
const clients: Client[] = [];

beforeEach(async () => {
  databasePath = makeMigratedDatabase();
  await seedStocks(databasePath, [
    { symbol: "AI.PA", name: "Air Liquide" },
    { symbol: "MC.PA", name: "LVMH" },
    { symbol: "OR.PA", name: "L'Oréal", inWatchlist: false },
  ]);
  vi.stubEnv("DATABASE_PATH", databasePath);
  vi.stubEnv("MCP_TOKEN", MCP_TEST_TOKEN);
  vi.resetModules();
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

function payloadWithNotes(...notes: JsonObject[]): JsonObject {
  return { ...validPayload(), stockNotes: notes };
}

const FULL_NOTE: JsonObject = {
  symbol: "AI.PA",
  reason: "earnings",
  summary: "Air Liquide publie des **résultats** au-dessus des attentes.",
  newsRefs: ["https://example.com/air-liquide", "https://example.org/resultats"],
  nextEvent: "Assemblée générale le 6 mai",
};
const MINIMAL_NOTE: JsonObject = { symbol: "MC.PA", reason: "move", summary: "LVMH recule avec le luxe." };

describe("#97 — given a payload with stockNotes, when Claude publishes, then each note is stored with its reason, summary, links and next event", () => {
  it("#97 — given two notes, when Claude publishes, then stock_notes holds one row per note in order with every field", async () => {
    const client = await connect();

    const result = await publish(client, { date: DATE, kind: "daily", payload: payloadWithNotes(FULL_NOTE, MINIMAL_NOTE) });

    expect(result.isError, resultText(result)).not.toBe(true);
    const brief = readBriefs(databasePath)[0];
    const rows = readStockNotes(databasePath);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      brief_id: brief.id,
      symbol: "AI.PA",
      reason: "earnings",
      summary: FULL_NOTE.summary,
      next_event: "Assemblée générale le 6 mai",
    });
    expect(JSON.parse(rows[0].news_refs)).toEqual(FULL_NOTE.newsRefs);
    expect(rows[1]).toMatchObject({ brief_id: brief.id, symbol: "MC.PA", reason: "move", summary: MINIMAL_NOTE.summary, next_event: null });
    expect(JSON.parse(rows[1].news_refs)).toEqual([]);
  });

  it("#97 — given a payload without stockNotes, when Claude publishes, then no note is stored", async () => {
    const client = await connect();
    const result = await publish(client, { date: DATE, kind: "daily", payload: validPayload() });
    expect(result.isError, resultText(result)).not.toBe(true);
    expect(readStockNotes(databasePath)).toEqual([]);
  });

  it("#97 — given a dry run with notes, when Claude publishes, then it answers OK and writes nothing", async () => {
    const client = await connect();
    const result = await publish(client, { date: DATE, kind: "daily", payload: payloadWithNotes(FULL_NOTE), dry_run: true });
    expect(result.isError, resultText(result)).not.toBe(true);
    expect(readStockNotes(databasePath)).toEqual([]);
    expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
  });

  it("#97 — given a published brief with notes, when Claude republishes the same date and kind, then the notes are replaced, not duplicated", async () => {
    const client = await connect();
    await publish(client, { date: DATE, kind: "daily", payload: payloadWithNotes(FULL_NOTE, MINIMAL_NOTE) });

    const result = await publish(client, {
      date: DATE,
      kind: "daily",
      payload: { ...otherValidPayload(), stockNotes: [{ symbol: "MC.PA", reason: "news", summary: "Nouvelle fiche." }] },
    });

    expect(result.isError, resultText(result)).not.toBe(true);
    const rows = readStockNotes(databasePath);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol: "MC.PA", reason: "news", summary: "Nouvelle fiche." });
  });

  it("#97 — given a published brief with notes, when Claude republishes without notes, then the old notes are removed", async () => {
    const client = await connect();
    await publish(client, { date: DATE, kind: "daily", payload: payloadWithNotes(FULL_NOTE) });
    await publish(client, { date: DATE, kind: "daily", payload: otherValidPayload() });
    expect(readStockNotes(databasePath)).toEqual([]);
  });

  it("#97 — given notes on a daily and a weekly brief of the same date, when both are published, then each keeps its own notes", async () => {
    const client = await connect();
    await publish(client, { date: DATE, kind: "daily", payload: payloadWithNotes(FULL_NOTE) });
    await publish(client, { date: DATE, kind: "weekly", payload: payloadWithNotes(MINIMAL_NOTE, { ...MINIMAL_NOTE, symbol: "AI.PA" }) });
    const briefs = readBriefs(databasePath);
    const rows = readStockNotes(databasePath);
    // US #29: the recap covers every followed stock (two here).
    expect(rows).toHaveLength(3);
    const daily = briefs.find((b) => b.kind === "daily")!;
    expect(rows.find((r) => r.brief_id === daily.id)?.symbol).toBe("AI.PA");
  });

  it("#97 — given a payload with an unknown reason, when Claude publishes, then it is a validation error at the note's path and nothing is written", async () => {
    const client = await connect();
    const result = await publish(client, { date: DATE, kind: "daily", payload: payloadWithNotes({ ...FULL_NOTE, reason: "rumeur" }) });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/payload\.stockNotes\.0\.reason\s*:\s*\S/);
    expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
  });

  it("#97 — given the tool list, when Claude reads the publish_brief schema, then stockNotes is part of the payload contract", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "publish_brief");
    expect(JSON.stringify(tool?.inputSchema)).toContain("stockNotes");
  });
});

describe("#98 — given a note for a symbol outside the watchlist, when Claude publishes, then the tool refuses with a message naming the symbol", () => {
  it.each([true, false])("#98 — given a symbol unknown to the app, when Claude publishes (dry_run %s), then it refuses, names the symbol and its path, and writes nothing", async (dryRun) => {
    const client = await connect();

    const result = await publish(client, {
      date: DATE,
      kind: "daily",
      payload: payloadWithNotes(FULL_NOTE, { ...MINIMAL_NOTE, symbol: "ZZZ.PA" }),
      dry_run: dryRun,
    });

    expect(result.isError).toBe(true);
    const text = resultText(result);
    expect(text).toContain("ZZZ.PA");
    expect(text).toMatch(/payload\.stockNotes\.1\.symbol\s*:\s*\S/);
    expect(text).not.toMatch(/payload\.stockNotes\.0\.symbol/);
    expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
    expect(readStockNotes(databasePath)).toEqual([]);
  });

  it("#98 — given a known instrument that is not followed, when Claude publishes, then it refuses and names the symbol", async () => {
    const client = await connect();
    const result = await publish(client, { date: DATE, kind: "daily", payload: payloadWithNotes({ ...MINIMAL_NOTE, symbol: "OR.PA" }) });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("OR.PA");
    expect(resultText(result)).toMatch(/payload\.stockNotes\.0\.symbol\s*:\s*\S/);
    expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
  });

  it("#98 — given a default instrument outside the watchlist (an index), when Claude publishes a note on it, then it refuses and names it", async () => {
    const client = await connect();
    const result = await publish(client, { date: DATE, kind: "daily", payload: payloadWithNotes({ ...MINIMAL_NOTE, symbol: "^FCHI" }) });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("^FCHI");
    expect(readStockNotes(databasePath)).toEqual([]);
  });

  it("#98 — given two offending notes, when Claude publishes, then both are named at once", async () => {
    const client = await connect();
    const result = await publish(client, {
      date: DATE,
      kind: "daily",
      payload: payloadWithNotes({ ...MINIMAL_NOTE, symbol: "ZZZ.PA" }, FULL_NOTE, { ...MINIMAL_NOTE, symbol: "OR.PA" }),
    });
    expect(result.isError).toBe(true);
    const text = resultText(result);
    expect(text).toContain("ZZZ.PA");
    expect(text).toContain("OR.PA");
    expect(text).toMatch(/payload\.stockNotes\.0\.symbol\s*:/);
    expect(text).toMatch(/payload\.stockNotes\.2\.symbol\s*:/);
  });

  it("#98 — given a brief with notes already published, when a republication names a symbol outside the watchlist, then the published brief and its notes stay untouched", async () => {
    const client = await connect();
    await publish(client, { date: DATE, kind: "daily", payload: payloadWithNotes(FULL_NOTE, MINIMAL_NOTE) });
    const before = { briefs: readBriefs(databasePath), news: readNewsItems(databasePath), notes: readStockNotes(databasePath) };
    expect(before.notes).toHaveLength(2);

    const result = await publish(client, {
      date: DATE,
      kind: "daily",
      payload: { ...otherValidPayload(), stockNotes: [{ ...MINIMAL_NOTE, symbol: "ZZZ.PA" }] },
    });

    expect(result.isError).toBe(true);
    expect(readBriefs(databasePath)).toEqual(before.briefs);
    expect(readNewsItems(databasePath)).toEqual(before.news);
    expect(readStockNotes(databasePath)).toEqual(before.notes);
  });
});
