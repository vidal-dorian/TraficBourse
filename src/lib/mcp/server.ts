// MCP server behind /api/mcp (CLAUDE.md §7): stateless Streamable HTTP, bearer token auth (static token or OAuth),
// every tool call logged in `mcp_audit`.
//
// Stateless means a fresh server and transport per request: no session is kept in memory,
// so the web container can restart at any time without breaking the scheduled task's run.
//
// The low-level SDK `Server` is used on purpose: `McpServer` rejects unknown tools and invalid
// arguments before any callback of ours runs, so those calls would never reach the audit log.
// Here tools/call resolves the tool, validates its arguments and runs it in one audited block.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type CallToolResult,
  type Tool,
  type ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { recordToolCall, shortError } from "./audit";
import { checkMcpAuth, parseBearerToken } from "./auth";
import { getPublicUrl, resourceMetadataUrl } from "./oauth/config";
import { isValidAccessToken } from "./oauth/store";

type ToolArgs<Shape extends z.ZodRawShape> = z.infer<z.ZodObject<Shape>>;
type ToolResult = CallToolResult | Promise<CallToolResult>;

/**
 * A tool exposed over MCP. `inputSchema` is a Zod raw shape (as taken by the SDK's
 * `registerTool`); `handler` receives the validated arguments. A tool that needs them exactly as
 * received too (before defaults and transforms, e.g. to store a payload verbatim) sets
 * `rawArguments: true` and gets them as a second argument.
 */
export type McpTool<Shape extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  description: string;
  inputSchema: Shape;
  /** Hints listed to clients, e.g. `readOnlyHint` for a tool that never writes. */
  annotations?: ToolAnnotations;
} & (
  | {
      rawArguments?: false;
      // Method syntax keeps the parameter bivariant, so tools of any shape fit in one registry.
      handler(args: ToolArgs<Shape>): ToolResult;
    }
  | {
      rawArguments: true;
      handler(args: ToolArgs<Shape>, rawArguments: Record<string, unknown>): ToolResult;
    }
);

export type McpHandlerOptions = {
  tools: readonly McpTool[];
};

/** A registered tool with its argument validator and the JSON Schema listed to clients. */
type RegisteredTool = {
  tool: McpTool;
  input: z.ZodObject<z.ZodRawShape>;
  definition: Tool;
};

/** What the client gets back, and the error kept in the audit log (null on success). */
type CallOutcome = { result: CallToolResult; auditError: string | null };

const SERVER_INFO = { name: "trafic-bourse", version: "0.1.0" };

const NO_STORE = { "Cache-Control": "no-store" };

/** Sent instead of the error of a tool that threw: its message may hold internal details. */
const TOOL_FAILURE_MESSAGE = "Erreur interne : l'outil n'a pas pu aboutir.";

// Same short answer whatever the reason: the details stay in the server logs. When OAuth is
// configured the challenge points at the resource metadata, which is how a connector added
// without a header discovers the login (RFC 9728).
function unauthorized(): Response {
  const publicUrl = getPublicUrl();
  const challenge = publicUrl ? `Bearer resource_metadata="${resourceMetadataUrl(publicUrl)}"` : "Bearer";
  return new Response("Non autorisé.", {
    status: 401,
    headers: { "Content-Type": "text/plain; charset=utf-8", "WWW-Authenticate": challenge, ...NO_STORE },
  });
}

/** Option A (static MCP_TOKEN), or option B (a live OAuth access token, only when PUBLIC_URL enables OAuth). */
function isAuthorized(request: Request): boolean {
  const auth = checkMcpAuth(request);
  if (auth.ok) return true;

  const token = parseBearerToken(request.headers.get("authorization"));
  if (token && getPublicUrl() && isValidAccessToken(token)) return true;

  // Fail closed: without a token configured nobody gets in (OAuth tokens apart). Only worth a
  // log when OAuth is not there either; otherwise it is a normal setup.
  if (auth.reason === "not_configured" && !getPublicUrl()) console.error("MCP request refused: MCP_TOKEN is not set");
  return false;
}

function jsonRpcError(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers: { ...NO_STORE, ...headers } });
}

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

function firstText(result: CallToolResult): string {
  const text = result.content.find((item) => item.type === "text");
  return text?.type === "text" ? text.text : "";
}

function registerTools(tools: readonly McpTool[]): Map<string, RegisteredTool> {
  const registry = new Map<string, RegisteredTool>();
  for (const tool of tools) {
    if (registry.has(tool.name)) throw new Error(`MCP tool ${tool.name} is registered twice`);
    // Strict: a misspelt argument (e.g. `dryRun` for `dry_run`) is an error, never silently ignored.
    const input = z.strictObject(tool.inputSchema);
    // Same conversion as the SDK's `registerTool`: draft-7, input side of transforms.
    const inputSchema = z.toJSONSchema(input, { target: "draft-7", io: "input" }) as Tool["inputSchema"];
    registry.set(tool.name, { tool, input, definition: { name: tool.name, description: tool.description, inputSchema, annotations: tool.annotations } });
  }
  return registry;
}

/**
 * Invalid arguments: the client gets one `path: message` line per issue so it can fix them all
 * in one round trip; the audit keeps the paths and messages only, never the values sent.
 */
function invalidArguments(name: string, error: z.ZodError): CallOutcome {
  const issues = error.issues.map((issue) => `${issue.path.length ? issue.path.join(".") : "(racine)"} : ${issue.message}`);
  return {
    result: errorResult(`Arguments invalides pour l'outil ${name} :\n${issues.map((issue) => `- ${issue}`).join("\n")}`),
    auditError: shortError(`Invalid arguments: ${issues.join("; ")}`, "Invalid arguments"),
  };
}

/** Resolves, validates and runs one tools/call request; never throws. */
async function callTool(registry: Map<string, RegisteredTool>, params: CallToolRequest["params"]): Promise<CallOutcome> {
  const registered = registry.get(params.name);
  if (!registered) {
    return { result: errorResult(`Outil inconnu : ${params.name}.`), auditError: "Unknown tool" };
  }

  const rawArguments = params.arguments ?? {};
  const parsed = await registered.input.safeParseAsync(rawArguments);
  if (!parsed.success) return invalidArguments(params.name, parsed.error);

  try {
    const { tool } = registered;
    const result = await (tool.rawArguments ? tool.handler(parsed.data, rawArguments) : tool.handler(parsed.data));
    const auditError = result.isError ? shortError(firstText(result), "Tool returned an error result") : null;
    return { result, auditError };
  } catch (error) {
    console.error(`MCP tool ${params.name} threw`, error);
    const message = error instanceof Error ? error.message : String(error);
    return { result: errorResult(TOOL_FAILURE_MESSAGE), auditError: shortError(message, "Tool threw") };
  }
}

/** One tools/call, timed from lookup to result, with its audit row written whatever the outcome. */
async function runAudited(registry: Map<string, RegisteredTool>, params: CallToolRequest["params"]): Promise<CallToolResult> {
  const at = new Date();
  const started = performance.now();
  const { result, auditError } = await callTool(registry, params);
  const durationMs = Math.round(performance.now() - started);
  // The requested name is client input: keep it to one short line in the log.
  recordToolCall({ tool: shortError(params.name, "(unnamed)"), ok: auditError === null, error: auditError, durationMs, at });
  return result;
}

function buildServer(registry: Map<string, RegisteredTool>): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });
  // An empty registry lists nothing instead of failing with "method not found".
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...registry.values()].map((registered) => registered.definition),
  }));
  server.setRequestHandler(CallToolRequestSchema, (request) => runAudited(registry, request.params));
  return server;
}

/** The /api/mcp handler for a tool registry: auth first, then MCP. */
export function createMcpHandler({ tools }: McpHandlerOptions): (request: Request) => Promise<Response> {
  const registry = registerTools(tools);
  return async (request) => {
    if (!isAuthorized(request)) return unauthorized();

    // Stateless server: no standalone SSE stream (GET) and no session to end (DELETE).
    if (request.method !== "POST") {
      return jsonRpcError(405, -32000, "Method not allowed.", { Allow: "POST" });
    }

    const server = buildServer(registry);
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
