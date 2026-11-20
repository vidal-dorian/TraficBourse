// US #13 — hardening of publish_brief found in review (beyond C54 to C58):
// - tool arguments are strict: a misspelt `dryRun` is an error, so a wanted dry run is never
//   turned into a real publication by a typo;
// - a source URL carrying user info (`https://reuters.com@evil.example`) is rejected, since it
//   reads like one host and opens another;
// - the success text uses the singular for one news item.
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newsItem, validPayload } from "./fixtures/brief-payloads";
import { countBriefRows } from "./helpers/briefs";
import { connectClient, dispatch, makeMigratedDatabase, MCP_TEST_TOKEN, type RouteModule } from "./helpers/mcp";

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
});

async function connect(): Promise<Client> {
  const route = (await import("../src/app/api/mcp/route")) as unknown as RouteModule;
  const client = await connectClient((request) => dispatch(route, request), MCP_TEST_TOKEN);
  clients.push(client);
  return client;
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as { type: string; text?: string }[];
  return content.map((item) => item.text ?? "").join("\n");
}

describe("publish_brief hardening", () => {
  it("given a misspelt dryRun argument, when I call publish_brief, then it is refused and nothing is written", async () => {
    const client = await connect();

    const result = await client.callTool({
      name: "publish_brief",
      arguments: { date: DATE, kind: "daily", payload: validPayload(), dryRun: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/dryRun/);
    expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
  });

  it.each([
    ["a user name", "https://reuters.com@evil.example/article"],
    ["a user name and password", "https://user:secret@www.lesechos.fr/marches"],
  ])("given a source URL with %s, when I call publish_brief, then payload.news.0.sourceUrl is refused", async (_label, url) => {
    const client = await connect();
    const payload = { ...validPayload(), news: [newsItem({ sourceUrl: url })] };

    const result = await client.callTool({ name: "publish_brief", arguments: { date: DATE, kind: "daily", payload } });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/payload\.news\.0\.sourceUrl : /);
    expect(text(result)).not.toContain("secret");
    expect(countBriefRows(databasePath)).toEqual({ briefs: 0, newsItems: 0 });
  });

  it("given a payload with one news item, when I publish it, then the success text uses the singular", async () => {
    const client = await connect();
    const payload = { ...validPayload(), news: [newsItem()] };

    const result = await client.callTool({ name: "publish_brief", arguments: { date: DATE, kind: "daily", payload } });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("1 actualité.");
  });
});
