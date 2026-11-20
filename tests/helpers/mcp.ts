// Test helpers for the MCP endpoint (US #11).
//
// No HTTP server is started: the SDK client's `fetch` option routes every request it makes
// straight into a route handler (`(request: Request) => Promise<Response>`), so the tests
// go through exactly the same code path as a request reaching `/api/mcp`.
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../../src/lib/db/client";
import { rootPath } from "./project";
import { makeTempDir } from "./sqlite";

export const MCP_URL = "http://localhost:3000/api/mcp";

/** A token of the shape `openssl rand -hex 32` produces. */
export const MCP_TEST_TOKEN = "3f9a1c7e5b2d8f40a6c1e9b7d3f5a2c8e0b4d6f8a1c3e5b7d9f0a2c4e6b8d0f1";

export type RouteHandler = (request: Request) => Response | Promise<Response>;

/** Route module exports, keyed by HTTP method (`GET`, `POST`, `DELETE`, ...). */
export type RouteModule = Partial<Record<string, RouteHandler>>;

/** Dispatches to the handler exported for the request method, like Next.js does (405 otherwise). */
export function dispatch(route: RouteModule, request: Request): Promise<Response> {
  const handler = route[request.method.toUpperCase()];
  if (!handler) return Promise.resolve(new Response(null, { status: 405 }));
  return Promise.resolve(handler(request));
}

/** A JSON-RPC `initialize` request, the first message any MCP client sends. */
export function initializeRequest(headers: Record<string, string> = {}): Request {
  return new Request(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "acceptance-tests", version: "1.0.0" },
      },
    }),
  });
}

/** A JSON-RPC `tools/call` request sent without any prior handshake (stateless server). */
export function toolCallRequest(name: string, args: Record<string, unknown>, headers: Record<string, string> = {}): Request {
  return new Request(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Mcp-Protocol-Version": "2025-06-18",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }),
  });
}

/** An SDK client connected through `handle`, sending `Authorization: Bearer <token>`. */
export async function connectClient(handle: (request: Request) => Promise<Response>, token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: (url, init) => handle(new Request(url, init)),
  });
  const client = new Client({ name: "acceptance-tests", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

/** A fresh SQLite file with every committed migration applied (what `npm run db:migrate` does). */
export function makeMigratedDatabase(): string {
  const path = join(makeTempDir(), "bourse.db");
  const sqlite = openDatabase(path);
  try {
    migrate(drizzle(sqlite), { migrationsFolder: rootPath("src", "lib", "db", "migrations") });
  } finally {
    sqlite.close();
  }
  return path;
}
