// MCP server behind /api/mcp (CLAUDE.md §7): stateless Streamable HTTP, bearer token auth,
// every tool call logged in `mcp_audit`.
//
// Stateless means a fresh server and transport per request: no session is kept in memory,
// so the web container can restart at any time without breaking the scheduled task's run.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { recordToolCall, shortError } from "./audit";
import { checkMcpAuth } from "./auth";

/**
 * A tool exposed over MCP. `inputSchema` is a Zod raw shape (as taken by the SDK's
 * `registerTool`); `handler` receives the validated arguments.
 */
export type McpTool<Shape extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  description: string;
  inputSchema: Shape;
  // Method syntax keeps the parameter bivariant, so tools of any shape fit in one registry.
  handler(args: z.infer<z.ZodObject<Shape>>): CallToolResult | Promise<CallToolResult>;
};

export type McpHandlerOptions = {
  tools: readonly McpTool[];
};

const SERVER_INFO = { name: "trafic-bourse", version: "0.1.0" };

const NO_STORE = { "Cache-Control": "no-store" };

/** Sent instead of the error of a tool that threw: its message may hold internal details. */
const TOOL_FAILURE_MESSAGE = "Erreur interne : l'outil n'a pas pu aboutir.";

// Same short answer whatever the reason: the details stay in the server logs.
function unauthorized(): Response {
  return new Response("Non autorisé.", {
    status: 401,
    headers: { "Content-Type": "text/plain; charset=utf-8", "WWW-Authenticate": "Bearer", ...NO_STORE },
  });
}

function jsonRpcError(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers: { ...NO_STORE, ...headers } });
}

function firstText(result: CallToolResult): string {
  const text = result.content.find((item) => item.type === "text");
  return text?.type === "text" ? text.text : "";
}

/** Runs a tool and writes its audit row, whatever the outcome. */
async function runAudited(tool: McpTool, args: Record<string, unknown>): Promise<CallToolResult> {
  const at = new Date();
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const result = await tool.handler(args);
    const error = result.isError ? shortError(firstText(result), "Tool returned an error result") : null;
    recordToolCall({ tool: tool.name, ok: !result.isError, error, durationMs: elapsed(), at });
    return result;
  } catch (error) {
    const durationMs = elapsed();
    console.error(`MCP tool ${tool.name} threw`, error);
    const message = error instanceof Error ? error.message : String(error);
    recordToolCall({ tool: tool.name, ok: false, error: shortError(message, "Tool threw"), durationMs, at });
    return { isError: true, content: [{ type: "text", text: TOOL_FAILURE_MESSAGE }] };
  }
}

function buildServer(tools: readonly McpTool[]): McpServer {
  const server = new McpServer(SERVER_INFO);
  for (const tool of tools) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, (args) =>
      runAudited(tool, args),
    );
  }
  if (tools.length === 0) {
    // McpServer only answers tools/list once a tool is registered: an empty registry must
    // still list (nothing) instead of failing with "method not found".
    server.server.registerCapabilities({ tools: {} });
    server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
  }
  return server;
}

/** The /api/mcp handler for a tool registry: auth first, then MCP. */
export function createMcpHandler({ tools }: McpHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    const auth = checkMcpAuth(request);
    if (!auth.ok) {
      if (auth.reason === "not_configured") {
        // Fail closed: without a token configured nobody gets in.
        console.error("MCP request refused: MCP_TOKEN is not set");
      }
      return unauthorized();
    }

    // Stateless server: no standalone SSE stream (GET) and no session to end (DELETE).
    if (request.method !== "POST") {
      return jsonRpcError(405, -32000, "Method not allowed.", { Allow: "POST" });
    }

    const server = buildServer(tools);
    // JSON responses: the reply is complete when handleRequest resolves, so the per-request
    // server can be closed right after.
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      return await transport.handleRequest(request);
    } catch (error) {
      console.error("MCP request failed", error);
      return jsonRpcError(500, -32603, "Internal server error.");
    } finally {
      await server.close();
    }
  };
}
