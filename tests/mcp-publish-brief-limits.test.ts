// US #13 — `publish_brief` refuses an oversized payload (security review): a multi-megabyte
// source name or thousands of tickers are rejected before anything is written.
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { validPayload, type JsonObject } from "./fixtures/brief-payloads";
import { countBriefRows } from "./helpers/briefs";
import { connectClient, dispatch, makeMigratedDatabase, MCP_TEST_TOKEN, type RouteModule } from "./helpers/mcp";

let databasePath: string;
let client: Client | undefined;

beforeEach(() => {
  databasePath = makeMigratedDatabase();
  vi.stubEnv("DATABASE_PATH", databasePath);
  vi.stubEnv("MCP_TOKEN", MCP_TEST_TOKEN);
  vi.resetModules();
});

afterEach(async () => {
  await client?.close();
  client = undefined;
  vi.unstubAllEnvs();
});

it("given a payload with a 3 MB source name and 10,000 tickers, when it is published, then it is rejected with short errors and nothing is written", async () => {
  const route = (await import("../src/app/api/mcp/route")) as unknown as RouteModule;
  client = await connectClient((request) => dispatch(route, request), MCP_TEST_TOKEN);
  const payload = validPayload();
  const news = (payload.news as JsonObject[])[0];
  news.sourceName = "x".repeat(3_000_000);
  news.tickers = Array.from({ length: 10_000 }, (_, i) => `T${i}`);

  const result = await client.callTool({
    name: "publish_brief",
    arguments: { date: "2026-11-20", kind: "daily", payload, dry_run: false },
  });

  expect(result.isError).toBe(true);
  const text = ((result.content ?? []) as { type: string; text?: string }[]).map((item) => item.text ?? "").join("\n");
  expect(text).toMatch(/payload\.news\.0\.sourceName\s*:\s*\S/);
  expect(text).toMatch(/payload\.news\.0\.tickers\s*:\s*\S/);
  expect(text.length).toBeLessThan(2_000);
  expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
});
