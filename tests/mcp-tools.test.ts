// US #11 — C49: with the right token, the MCP client lists the available tools.
//
// Integration test with the official SDK client (`@modelcontextprotocol/sdk`): its `fetch`
// option routes each request straight into the route handler, no HTTP server involved.
//
// Contract:
// - `src/app/api/mcp/route.ts` (see tests/mcp-auth.test.ts) serves a stateless Streamable HTTP
//   MCP server built from the production tool registry. `tools/list` succeeds even when that
//   registry is empty (no business tool exists before US #13).
// - `src/lib/mcp/server.ts` exports `createMcpHandler({ tools })`, which returns the handler
//   behind the route — auth, then MCP — for a given tool registry. A tool is
//   `{ name, description, inputSchema, handler }`: `inputSchema` is a Zod raw shape (as taken by
//   the SDK's `registerTool`), `handler(args)` returns an MCP `CallToolResult`.
// - The route is never cached nor prerendered and runs on the Node.js runtime.
import { join } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { connectClient, dispatch, MCP_TEST_TOKEN, type RouteModule } from "./helpers/mcp";
import { makeTempDir } from "./helpers/sqlite";

type CreateMcpHandler = (options: { tools: unknown[] }) => (request: Request) => Promise<Response>;

describe("C49 — with the right token, the MCP client lists the available tools", () => {
  const clients: Client[] = [];

  beforeEach(() => {
    vi.stubEnv("DATABASE_PATH", join(makeTempDir(), "bourse.db"));
    vi.stubEnv("MCP_TOKEN", MCP_TEST_TOKEN);
    vi.resetModules();
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    vi.unstubAllEnvs();
  });

  it("C49 — given the right token, when the MCP client lists the tools of /api/mcp, then it receives the list of available tools", async () => {
    const route = (await import("../src/app/api/mcp/route")) as unknown as RouteModule & { dynamic?: string; runtime?: string };
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.runtime ?? "nodejs").toBe("nodejs");

    const client = await connectClient((request) => dispatch(route, request), MCP_TEST_TOKEN);
    clients.push(client);
    const result = await client.listTools();

    // The production registry may be empty for now: the list must still come back.
    expect(Array.isArray(result.tools)).toBe(true);
    for (const tool of result.tools) {
      expect(typeof tool.name).toBe("string");
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
  });

  it("C49 — given the right token and a server built with tools, when the MCP client lists the tools, then it receives each tool with its description and input schema", async () => {
    const { createMcpHandler } = (await import("../src/lib/mcp/server")) as unknown as { createMcpHandler: CreateMcpHandler };
    const handle = createMcpHandler({
      tools: [
        {
          name: "echo_test",
          description: "Test-only tool: echoes a message.",
          inputSchema: { message: z.string() },
          handler: async ({ message }: { message: string }) => ({ content: [{ type: "text", text: message }] }),
        },
        {
          name: "ping_test",
          description: "Test-only tool without arguments.",
          inputSchema: {},
          handler: async () => ({ content: [{ type: "text", text: "pong" }] }),
        },
      ],
    });

    const client = await connectClient(handle, MCP_TEST_TOKEN);
    clients.push(client);
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(["echo_test", "ping_test"]);
    const echo = tools.find((tool) => tool.name === "echo_test");
    expect(echo?.description).toBe("Test-only tool: echoes a message.");
    expect(echo?.inputSchema).toMatchObject({ type: "object", properties: { message: { type: "string" } } });
    expect(echo?.inputSchema.required).toEqual(["message"]);
  });

  it("C49 — given a server built with zero tools, when the MCP client lists the tools, then it receives an empty list (not an error)", async () => {
    const { createMcpHandler } = (await import("../src/lib/mcp/server")) as unknown as { createMcpHandler: CreateMcpHandler };

    const client = await connectClient(createMcpHandler({ tools: [] }), MCP_TEST_TOKEN);
    clients.push(client);

    await expect(client.listTools()).resolves.toMatchObject({ tools: [] });
  });

  it("C49 — given a wrong token, when the MCP client connects, then it is refused and lists nothing", async () => {
    const { createMcpHandler } = (await import("../src/lib/mcp/server")) as unknown as { createMcpHandler: CreateMcpHandler };

    await expect(connectClient(createMcpHandler({ tools: [] }), `${MCP_TEST_TOKEN}x`)).rejects.toThrow();
  });
});
