// US #11 — C50: every MCP tool call adds a row to `mcp_audit`.
//
// Contract:
// - The committed Drizzle migrations create the `mcp_audit` table (CLAUDE.md §6) with the
//   columns `tool` (text), `ok` (boolean, stored as 0/1), `error` (text, null on success),
//   `duration_ms` (integer) and `at` (when the call happened, not null).
// - Every tool registered through `createMcpHandler({ tools })` (`src/lib/mcp/server.ts`, see
//   tests/mcp-tools.test.ts) goes through one audit wrapper: when a call finishes, one row is
//   written to the database at `DATABASE_PATH`, whether the tool succeeded, returned an error
//   result (`isError: true`) or threw.
// - The `error` text is short and never holds the call's arguments.
// - A failing audit write never leaks database details to the client.
import { createRequire } from "node:module";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { connectClient, makeMigratedDatabase, MCP_TEST_TOKEN } from "./helpers/mcp";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

type CreateMcpHandler = (options: { tools: unknown[] }) => (request: Request) => Promise<Response>;

type AuditRow = { tool: string; ok: number; error: string | null; duration_ms: number; at: unknown };

/** Argument value that must never end up in the audit log. */
const SECRET_ARGUMENT = "payload-that-must-not-be-logged-7f3e";

const testTools = [
  {
    name: "echo_test",
    description: "Test-only tool: echoes a message after a short delay.",
    inputSchema: { message: z.string() },
    handler: async ({ message }: { message: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { content: [{ type: "text", text: `echo: ${message}` }] };
    },
  },
  {
    name: "throwing_test",
    description: "Test-only tool that throws.",
    inputSchema: { message: z.string() },
    handler: async () => {
      throw new Error("Échec simulé de l'outil");
    },
  },
  {
    name: "error_result_test",
    description: "Test-only tool that returns an error result.",
    inputSchema: { message: z.string() },
    handler: async () => ({ isError: true, content: [{ type: "text", text: "Refus simulé par l'outil" }] }),
  },
];

function readAudit(databasePath: string): AuditRow[] {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return db.prepare("SELECT tool, ok, error, duration_ms, at FROM mcp_audit ORDER BY rowid").all() as AuditRow[];
  } finally {
    db.close();
  }
}

function resultText(result: unknown): string {
  return JSON.stringify(result);
}

describe("C50 — every MCP tool call adds a row to mcp_audit", () => {
  let databasePath: string;
  let client: Client | undefined;

  beforeEach(async () => {
    databasePath = makeMigratedDatabase();
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("MCP_TOKEN", MCP_TEST_TOKEN);
    vi.resetModules();
  });

  afterEach(async () => {
    await client?.close();
    client = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function connect(): Promise<Client> {
    const { createMcpHandler } = (await import("../src/lib/mcp/server")) as unknown as { createMcpHandler: CreateMcpHandler };
    client = await connectClient(createMcpHandler({ tools: testTools }), MCP_TEST_TOKEN);
    return client;
  }

  it("C50 — given the migrations are applied, when I inspect the database, then the mcp_audit table exists and is empty", () => {
    expect(readAudit(databasePath)).toEqual([]);
  });

  it("C50 — given a successful tool call, when it finishes, then one row is added to mcp_audit with the tool, ok, no error and the duration", async () => {
    const mcp = await connect();

    const result = await mcp.callTool({ name: "echo_test", arguments: { message: SECRET_ARGUMENT } });

    expect(result.isError).not.toBe(true);
    expect(resultText(result)).toContain(`echo: ${SECRET_ARGUMENT}`);
    await vi.waitFor(() => expect(readAudit(databasePath)).toHaveLength(1));
    const [row] = readAudit(databasePath);
    expect(row.tool).toBe("echo_test");
    expect(row.ok).toBe(1);
    expect(row.error).toBeNull();
    expect(Number.isInteger(row.duration_ms)).toBe(true);
    // The tool waits 30 ms: the duration measures the call, not a constant.
    expect(row.duration_ms).toBeGreaterThanOrEqual(25);
    expect(row.duration_ms).toBeLessThan(10_000);
    expect(row.at).not.toBeNull();
  });

  it("C50 — given a tool call that throws, when it finishes, then one row is added to mcp_audit with ok false and a short error", async () => {
    const mcp = await connect();

    const result = await mcp.callTool({ name: "throwing_test", arguments: { message: SECRET_ARGUMENT } });

    expect(result.isError).toBe(true);
    await vi.waitFor(() => expect(readAudit(databasePath)).toHaveLength(1));
    const [row] = readAudit(databasePath);
    expect(row.tool).toBe("throwing_test");
    expect(row.ok).toBe(0);
    expect(typeof row.error).toBe("string");
    expect((row.error ?? "").trim().length).toBeGreaterThan(0);
    expect((row.error ?? "").length).toBeLessThanOrEqual(500);
    expect(row.error).not.toContain(SECRET_ARGUMENT);
    expect(Number.isInteger(row.duration_ms)).toBe(true);
    expect(row.duration_ms).toBeGreaterThanOrEqual(0);
    expect(row.at).not.toBeNull();
  });

  it("C50 — given a tool call that returns an error result, when it finishes, then one row is added to mcp_audit with ok false and a short error", async () => {
    const mcp = await connect();

    const result = await mcp.callTool({ name: "error_result_test", arguments: { message: SECRET_ARGUMENT } });

    expect(result.isError).toBe(true);
    await vi.waitFor(() => expect(readAudit(databasePath)).toHaveLength(1));
    const [row] = readAudit(databasePath);
    expect(row.tool).toBe("error_result_test");
    expect(row.ok).toBe(0);
    expect((row.error ?? "").trim().length).toBeGreaterThan(0);
    expect((row.error ?? "").length).toBeLessThanOrEqual(500);
    expect(row.error).not.toContain(SECRET_ARGUMENT);
    expect(row.at).not.toBeNull();
  });

  it("C50 — given several tool calls, when they finish, then each one adds its own row to mcp_audit, in order", async () => {
    const mcp = await connect();

    await mcp.callTool({ name: "echo_test", arguments: { message: "un" } });
    await mcp.callTool({ name: "throwing_test", arguments: { message: "deux" } });
    await mcp.callTool({ name: "echo_test", arguments: { message: "trois" } });

    await vi.waitFor(() => expect(readAudit(databasePath)).toHaveLength(3));
    expect(readAudit(databasePath).map((row) => [row.tool, row.ok])).toEqual([
      ["echo_test", 1],
      ["throwing_test", 0],
      ["echo_test", 1],
    ]);
  });

  it("C50 — given the audit write fails, when a tool call finishes, then the client sees no database detail", async () => {
    const { DatabaseSync: WritableDatabase } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new WritableDatabase(databasePath);
    try {
      db.exec("DROP TABLE mcp_audit");
    } finally {
      db.close();
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mcp = await connect();

    let seen: string;
    try {
      seen = resultText(await mcp.callTool({ name: "echo_test", arguments: { message: "bonjour" } }));
    } catch (error) {
      seen = String(error);
    }

    expect(seen).not.toMatch(/mcp_audit|no such table|sqlite/i);
    expect(seen).not.toContain(databasePath);
  });
});
