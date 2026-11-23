// US #17 — C71: dry run of the scheduled task, end to end.
//
// The Claude scheduled task follows the prompt: read context, then `publish_brief` with
// dry_run=true, then dry_run=false. This test replays that sequence with the official SDK client
// routed into the production /api/mcp route, with the tools that exist today. (The home page
// showing the brief is ticket T4, not covered here.)
import { createRequire } from "node:module";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validPayload } from "./fixtures/brief-payloads";
import { readBriefs, readNewsItems } from "./helpers/briefs";
import { connectClient, dispatch, makeMigratedDatabase, MCP_TEST_TOKEN, type RouteModule } from "./helpers/mcp";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const DATE = "2026-11-20";

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

function readAudit(): { tool: string; ok: number; error: string | null }[] {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return db.prepare("SELECT tool, ok, error FROM mcp_audit ORDER BY rowid").all() as {
      tool: string;
      ok: number;
      error: string | null;
    }[];
  } finally {
    db.close();
  }
}

describe("C71 — scheduled task dry run through /api/mcp", () => {
  it("C71 — given the connector is plugged with the bearer token, when the task runs its sequence manually, then the brief is published and every call is in mcp_audit", async () => {
    const route = (await import("../src/app/api/mcp/route")) as unknown as RouteModule;
    client = await connectClient((request) => dispatch(route, request), MCP_TEST_TOKEN);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("get_recent_briefs");
    expect(names).toContain("publish_brief");

    const recent = await client.callTool({ name: "get_recent_briefs", arguments: { days: 7 } });
    expect(recent.isError).not.toBe(true);

    const args = { date: DATE, kind: "daily", payload: validPayload() };
    const dry = await client.callTool({ name: "publish_brief", arguments: { ...args, dry_run: true } });
    expect(dry.isError).not.toBe(true);
    expect(readBriefs(databasePath)).toEqual([]);

    const real = await client.callTool({ name: "publish_brief", arguments: { ...args, dry_run: false } });
    expect(real.isError).not.toBe(true);

    const briefs = readBriefs(databasePath);
    expect(briefs).toHaveLength(1);
    expect(briefs[0]).toMatchObject({ date: DATE, kind: "daily", status: "published" });
    expect(briefs[0].published_at).not.toBeNull();
    expect(readNewsItems(databasePath).length).toBeGreaterThan(0);

    await vi.waitFor(() => expect(readAudit()).toHaveLength(3));
    const audit = readAudit();
    expect(audit.map((row) => row.tool)).toEqual(["get_recent_briefs", "publish_brief", "publish_brief"]);
    for (const row of audit) {
      expect(row.ok).toBe(1);
      expect(row.error).toBeNull();
    }
  });
});
