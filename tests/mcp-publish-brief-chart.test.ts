// US #22 — Claude cannot publish a chart on a symbol the app does not track (C85).
//
// Contract (`src/lib/mcp/tools/publish-brief.ts`):
// - after Zod, every chart symbol must exist in `instruments` (nine seeded by migration 0005).
//   An unknown one gives an `isError` result whose text names each unknown symbol with its path
//   (`payload.news.0.chart.symbols.1 : Symbole inconnu « ^XXX » …`), all at once, with dry_run
//   true or false, and nothing is written (a previously published brief stays untouched).
// - known symbols publish as usual and the parsed spec (normalize defaulted) is stored in the new
//   nullable JSON column `news_items.chart_spec` (null when the item has no chart).
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newsItem, otherValidPayload, validPayload, type Json, type JsonObject } from "./fixtures/brief-payloads";
import { countBriefRows, readBriefs, readNewsItems } from "./helpers/briefs";
import { connectClient, dispatch, makeMigratedDatabase, MCP_TEST_TOKEN, type RouteModule } from "./helpers/mcp";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

const DATE = "2026-11-20";

let databasePath: string;
const clients: Client[] = [];

beforeEach(() => {
  databasePath = makeMigratedDatabase();
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

function payloadWithCharts(...charts: (JsonObject | undefined)[]): JsonObject {
  const payload = validPayload();
  const news = payload.news as JsonObject[];
  charts.forEach((chart, index) => (news[index] = newsItem(chart ? { chart } : {})));
  return payload;
}

const known = (symbols: string[]): JsonObject => ({ type: "price", symbols, range: "1M", normalize: true });

describe("C85 — an unknown symbol in a spec is refused with a message naming it", () => {
  it.each([true, false])("given an unknown symbol in a spec, when Claude calls publish_brief (dry_run %s), then it refuses and names the symbol and its path", async (dryRun) => {
    const client = await connect();

    const result = await publish(client, {
      date: DATE,
      kind: "daily",
      payload: payloadWithCharts(known(["^FCHI", "^XXX"])),
      dry_run: dryRun,
    });

    expect(result.isError).toBe(true);
    const text = resultText(result);
    expect(text).toContain("^XXX");
    expect(text).toMatch(/payload\.news\.0\.chart\.symbols\.1\s*:\s*\S/);
    expect(text).not.toContain("« ^FCHI »");
    expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
  });

  it("given two unknown symbols in two news items, when Claude calls publish_brief, then both are named at once with their paths", async () => {
    const client = await connect();

    const result = await publish(client, {
      date: DATE,
      kind: "daily",
      payload: payloadWithCharts(known(["^NOPE"]), undefined, known(["^FCHI", "^GSPC", "ZZZ.PA"])),
    });

    expect(result.isError).toBe(true);
    const text = resultText(result);
    expect(text).toContain("^NOPE");
    expect(text).toContain("ZZZ.PA");
    expect(text).toMatch(/payload\.news\.0\.chart\.symbols\.0\s*:/);
    expect(text).toMatch(/payload\.news\.2\.chart\.symbols\.2\s*:/);
    expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
  });

  it("given a brief already published for the date, when a republication has an unknown symbol, then the published brief stays untouched", async () => {
    const client = await connect();
    const first = await publish(client, { date: DATE, kind: "daily", payload: otherValidPayload() });
    expect(first.isError).not.toBe(true);
    const before = { briefs: readBriefs(databasePath), news: readNewsItems(databasePath) };

    const result = await publish(client, { date: DATE, kind: "daily", payload: payloadWithCharts(known(["^XXX"])) });

    expect(result.isError).toBe(true);
    expect(readBriefs(databasePath)).toEqual(before.briefs);
    expect(readNewsItems(databasePath)).toEqual(before.news);
  });

  it("given an invalid spec (four symbols), when Claude calls publish_brief, then the error is a validation error at the chart path", async () => {
    const client = await connect();

    const result = await publish(client, {
      date: DATE,
      kind: "daily",
      payload: payloadWithCharts(known(["^FCHI", "^GSPC", "^NDX", "GC=F"])),
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/payload\.news\.0\.chart\.symbols\s*:/);
  });
});

describe("C85 — known symbols are published and the spec is stored", () => {
  it("given the spec of the story on known symbols, when Claude calls publish_brief with dry_run, then it answers OK and writes nothing", async () => {
    const client = await connect();

    const result = await publish(client, { date: DATE, kind: "daily", payload: payloadWithCharts(known(["^FCHI", "^GSPC"])), dry_run: true });

    expect(result.isError).not.toBe(true);
    expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
  });

  it("given known symbols, when Claude publishes, then chart_spec holds the spec with normalize defaulted, and null for an item without chart", async () => {
    const client = await connect();
    const payload = payloadWithCharts(known(["^FCHI", "^GSPC"]), { type: "price", symbols: ["GC=F"], range: "YTD" });

    const result = await publish(client, { date: DATE, kind: "daily", payload });

    expect(result.isError, resultText(result)).not.toBe(true);
    const rows = readNewsItems(databasePath) as unknown as { chart_spec: string | null }[];
    expect(rows).toHaveLength(3);
    expect(JSON.parse(rows[0].chart_spec as string)).toEqual({ type: "price", symbols: ["^FCHI", "^GSPC"], range: "1M", normalize: true });
    expect(JSON.parse(rows[1].chart_spec as string)).toEqual({ type: "price", symbols: ["GC=F"], range: "YTD", normalize: false });
    expect(rows[2].chart_spec).toBeNull();
  });

  it("given a brief republished without chart, when it replaces the one with a chart, then chart_spec is null", async () => {
    const client = await connect();
    await publish(client, { date: DATE, kind: "daily", payload: payloadWithCharts(known(["^FCHI"])) });

    await publish(client, { date: DATE, kind: "daily", payload: otherValidPayload() });

    const rows = readNewsItems(databasePath) as unknown as { chart_spec: string | null }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.chart_spec === null)).toBe(true);
  });

  it("given the tool listing, when Claude lists the tools, then the news item schema offers a chart", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "publish_brief");
    const schema = tool?.inputSchema as { properties: { payload: { properties: { news: { items: { properties: Record<string, unknown> } } } } } };
    expect(Object.keys(schema.properties.payload.properties.news.items.properties)).toContain("chart");
  });
});
