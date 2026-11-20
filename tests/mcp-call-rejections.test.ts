// US #11 — C50, calls rejected before the tool runs: an unknown tool name or arguments that fail
// the tool's input schema still finish with an error, so they get their own `mcp_audit` row.
import { createRequire } from "node:module";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { connectClient, makeMigratedDatabase, MCP_TEST_TOKEN } from "./helpers/mcp";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

type AuditRow = { tool: string; ok: number; error: string | null; duration_ms: number };

/** Argument value that must never end up in the audit log. */
const SECRET_ARGUMENT = "payload-that-must-not-be-logged-7f3e";

function readAudit(databasePath: string): AuditRow[] {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return db.prepare("SELECT tool, ok, error, duration_ms FROM mcp_audit ORDER BY rowid").all() as AuditRow[];
  } finally {
    db.close();
  }
}

describe("C50 — calls rejected before the tool runs are audited too", () => {
  let databasePath: string;
  let client: Client | undefined;
  const handler = vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }] }));

  beforeEach(() => {
    databasePath = makeMigratedDatabase();
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("MCP_TOKEN", MCP_TEST_TOKEN);
    vi.resetModules();
    handler.mockClear();
  });

  afterEach(async () => {
    await client?.close();
    client = undefined;
    vi.unstubAllEnvs();
  });

  async function connect(): Promise<Client> {
    const { createMcpHandler } = await import("../src/lib/mcp/server");
    const tool = {
      name: "strict_test",
      description: "Test-only tool with a strict input schema.",
      inputSchema: { message: z.string(), count: z.number().int() },
      handler,
    };
    client = await connectClient(createMcpHandler({ tools: [tool] }), MCP_TEST_TOKEN);
    return client;
  }

  it("C50 — given arguments that fail input validation, when the call finishes, then the tool does not run and one row with ok false is written", async () => {
    const mcp = await connect();

    const result = await mcp.callTool({ name: "strict_test", arguments: { message: 42, count: SECRET_ARGUMENT } });

    expect(result.isError).toBe(true);
    // Every invalid field is reported with its path, so the caller can fix them in one round trip.
    expect(JSON.stringify(result.content)).toMatch(/message.*count/s);
    expect(handler).not.toHaveBeenCalled();
    const rows = readAudit(databasePath);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tool: "strict_test", ok: 0 });
    expect(rows[0].error).toMatch(/^Invalid arguments/);
    expect(rows[0].error).not.toContain(SECRET_ARGUMENT);
    expect(Number.isInteger(rows[0].duration_ms)).toBe(true);
  });

  it("C50 — given missing arguments, when the call finishes, then one row with ok false is written", async () => {
    const mcp = await connect();

    const result = await mcp.callTool({ name: "strict_test" });

    expect(result.isError).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(readAudit(databasePath)).toMatchObject([{ tool: "strict_test", ok: 0 }]);
  });

  it("C50 — given an unknown tool name, when the call finishes, then one row with ok false is written under that name", async () => {
    const mcp = await connect();

    const result = await mcp.callTool({ name: "nope", arguments: { message: SECRET_ARGUMENT } });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Outil inconnu");
    expect(readAudit(databasePath)).toMatchObject([{ tool: "nope", ok: 0, error: "Unknown tool" }]);
  });

  it("C50 — given a very long unknown tool name, when the call finishes, then the audit keeps a short name", async () => {
    const mcp = await connect();

    await mcp.callTool({ name: "x".repeat(5_000) });

    const [row] = readAudit(databasePath);
    expect(row.ok).toBe(0);
    expect(row.tool.length).toBeLessThanOrEqual(200);
  });

  it("C50 — given valid arguments, when the call finishes, then the tool receives them parsed and the row says ok", async () => {
    const mcp = await connect();

    const result = await mcp.callTool({ name: "strict_test", arguments: { message: "bonjour", count: 2 } });

    expect(result.isError).not.toBe(true);
    expect(handler).toHaveBeenCalledWith({ message: "bonjour", count: 2 });
    expect(readAudit(databasePath)).toMatchObject([{ tool: "strict_test", ok: 1, error: null }]);
  });
});
